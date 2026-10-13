#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dwmapi.h>
#include <d3d11.h>
#include <dxgi1_5.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <algorithm>
#include <chrono>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include <map>
#include <memory>
#include "color.h"

using Microsoft::WRL::ComPtr;
using Clock = std::chrono::steady_clock;
namespace {
double elapsed(Clock::time_point start) { return std::chrono::duration<double,std::milli>(Clock::now()-start).count(); }
void require(HRESULT hr, const char* message) { if (FAILED(hr)) throw std::runtime_error(message); }
void writeAll(const void* bytes, size_t length) {
  const auto* cursor = static_cast<const uint8_t*>(bytes);
  while (length) { DWORD written = 0; if (!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),cursor,static_cast<DWORD>(std::min<size_t>(length,1<<20)),&written,nullptr) || !written) throw std::runtime_error("output closed"); cursor += written; length -= written; }
}
void line(const std::string& value) { const auto text = value + "\n"; writeAll(text.data(),text.size()); }
struct MonitorColor { bool hdr = false; unsigned whiteLevel = 1000; };
// Stable public Windows ABI, including builds with older SDK headers.
struct AdvancedColor { DISPLAYCONFIG_DEVICE_INFO_HEADER header; UINT32 flags; UINT32 encoding; UINT32 bits; };
struct SdrWhite { DISPLAYCONFIG_DEVICE_INFO_HEADER header; ULONG level; };
MonitorColor monitorColor(HMONITOR monitor) {
  MonitorColor result;
  MONITORINFOEXW info{}; info.cbSize = sizeof(info); if (!GetMonitorInfoW(monitor,reinterpret_cast<MONITORINFO*>(&info))) return result;
  UINT32 pathCount=0,modeCount=0;
  if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS,&pathCount,&modeCount) != ERROR_SUCCESS) return result;
  std::vector<DISPLAYCONFIG_PATH_INFO> paths(pathCount); std::vector<DISPLAYCONFIG_MODE_INFO> modes(modeCount);
  if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS,&pathCount,paths.data(),&modeCount,modes.data(),nullptr) != ERROR_SUCCESS) return result;
  for (UINT32 i=0;i<pathCount;i++) {
    const auto& path = paths[i];
    DISPLAYCONFIG_SOURCE_DEVICE_NAME name{}; name.header.type=DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME; name.header.size=sizeof(name); name.header.adapterId=path.sourceInfo.adapterId; name.header.id=path.sourceInfo.id;
    if (DisplayConfigGetDeviceInfo(&name.header) != ERROR_SUCCESS || wcscmp(name.viewGdiDeviceName,info.szDevice) != 0) continue;
    AdvancedColor color{}; color.header.type=static_cast<DISPLAYCONFIG_DEVICE_INFO_TYPE>(9); color.header.size=sizeof(color); color.header.adapterId=path.targetInfo.adapterId; color.header.id=path.targetInfo.id;
    if (DisplayConfigGetDeviceInfo(&color.header) == ERROR_SUCCESS) result.hdr=(color.flags&2)!=0;
    SdrWhite white{}; white.header.type=static_cast<DISPLAYCONFIG_DEVICE_INFO_TYPE>(11); white.header.size=sizeof(white); white.header.adapterId=path.targetInfo.adapterId; white.header.id=path.targetInfo.id;
    if (DisplayConfigGetDeviceInfo(&white.header) == ERROR_SUCCESS && white.level >= 1000 && white.level <= 10000) result.whiteLevel=white.level;
    break;
  }
  return result;
}
struct Frame { unsigned width=0,height=0; std::vector<uint8_t> data; DXGI_FORMAT format=DXGI_FORMAT_B8G8R8A8_UNORM; MonitorColor color; const char* backend="dxgi"; LONGLONG present=0; UINT accumulated=0; };
struct Duplication {
  ComPtr<ID3D11Device> device; ComPtr<ID3D11DeviceContext> context; ComPtr<IDXGIOutputDuplication> duplication;
  ComPtr<ID3D11Texture2D> staging; RECT bounds{}; DXGI_MODE_ROTATION rotation=DXGI_MODE_ROTATION_IDENTITY;
  bool completeFrame=false;
  void reset() { staging.Reset(); duplication.Reset(); context.Reset(); device.Reset(); completeFrame=false; }
  void init(HMONITOR monitor) {
    reset(); ComPtr<IDXGIFactory1> factory; require(CreateDXGIFactory1(IID_PPV_ARGS(factory.GetAddressOf())),"DXGI factory failed");
    for (UINT i=0;;i++) {
      ComPtr<IDXGIAdapter1> adapter; if (factory->EnumAdapters1(i,adapter.GetAddressOf()) == DXGI_ERROR_NOT_FOUND) break;
      for(UINT j=0;;j++) {
        ComPtr<IDXGIOutput> output; if(adapter->EnumOutputs(j,output.GetAddressOf()) == DXGI_ERROR_NOT_FOUND) break;
        DXGI_OUTPUT_DESC desc{}; if(FAILED(output->GetDesc(&desc)) || desc.Monitor != monitor) continue;
        require(D3D11CreateDevice(adapter.Get(),D3D_DRIVER_TYPE_UNKNOWN,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,device.GetAddressOf(),nullptr,context.GetAddressOf()),"D3D device failed");
        ComPtr<IDXGIOutput5> modern; require(output.As(&modern),"HDR capture interface unavailable");
        const DXGI_FORMAT formats[]={DXGI_FORMAT_R16G16B16A16_FLOAT,DXGI_FORMAT_B8G8R8A8_UNORM};
        require(modern->DuplicateOutput1(device.Get(),0,monitorColor(monitor).hdr ? 1 : 2,formats,duplication.GetAddressOf()),"Desktop duplication failed");
        bounds=desc.DesktopCoordinates; rotation=desc.Rotation; return;
      }
    }
    throw std::runtime_error("Monitor not found");
  }
  Frame grab(HMONITOR monitor) {
    if (!duplication) init(monitor);
    for(unsigned attempt=0;attempt<3;attempt++) {
    DXGI_OUTDUPL_FRAME_INFO info{}; ComPtr<IDXGIResource> resource;
    HRESULT hr=duplication->AcquireNextFrame(40, &info,resource.GetAddressOf());
    if(hr==DXGI_ERROR_ACCESS_LOST || hr==DXGI_ERROR_WAIT_TIMEOUT) {
      // Re-open an idle duplication to get a current full frame; never retain an
      // old user screenshot between sessions just to satisfy a timeout.
      init(monitor); hr=duplication->AcquireNextFrame(160,&info,resource.GetAddressOf());
    }
    require(hr,"No desktop frame available");
    try {
      ComPtr<ID3D11Texture2D> texture; require(resource.As(&texture),"Invalid desktop texture"); D3D11_TEXTURE2D_DESC desc{}; texture->GetDesc(&desc);
      D3D11_TEXTURE2D_DESC previous{}; if(staging) staging->GetDesc(&previous);
      if(!staging || desc.Width!=previous.Width || desc.Height!=previous.Height || desc.Format!=previous.Format) {
        staging.Reset(); desc.Usage=D3D11_USAGE_STAGING; desc.BindFlags=0; desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ; desc.MiscFlags=0;
        require(device->CreateTexture2D(&desc,nullptr,staging.GetAddressOf()),"Staging texture failed");
      }
      context->CopyResource(staging.Get(),texture.Get());
      Frame frame=read(monitor); frame.present=info.LastPresentTime.QuadPart; frame.accumulated=info.AccumulatedFrames;
      // Some HDR drivers report an all-zero texture while a newly opened
      // duplication is warming up. It is not a completed desktop screenshot.
      if(!completeFrame && std::all_of(frame.data.begin(),frame.data.end(),[](uint8_t value){return value==0;})) {
        duplication->ReleaseFrame(); staging.Reset(); continue;
      }
      completeFrame=true; duplication->ReleaseFrame(); return frame;
    } catch(...) { duplication->ReleaseFrame(); throw; }
    }
    throw std::runtime_error("Desktop frame is not ready");
  }
  Frame read(HMONITOR monitor) {
    D3D11_TEXTURE2D_DESC desc{}; staging->GetDesc(&desc);
    if(desc.Format!=DXGI_FORMAT_R16G16B16A16_FLOAT && desc.Format!=DXGI_FORMAT_B8G8R8A8_UNORM && desc.Format!=DXGI_FORMAT_R8G8B8A8_UNORM) throw std::runtime_error("Unsupported frame format");
    D3D11_MAPPED_SUBRESOURCE mapped{}; require(context->Map(staging.Get(),0,D3D11_MAP_READ,0,&mapped),"Map desktop failed");
    Frame frame; frame.width=desc.Width; frame.height=desc.Height; frame.format=desc.Format; frame.color=monitorColor(monitor);
    if(frame.color.hdr && frame.format!=DXGI_FORMAT_R16G16B16A16_FLOAT) { context->Unmap(staging.Get(),0); throw std::runtime_error("HDR float capture unavailable"); }
    const size_t stride=static_cast<size_t>(desc.Width)*(desc.Format==DXGI_FORMAT_R16G16B16A16_FLOAT ? 8 : 4);
    frame.data.resize(stride*desc.Height);
    for(unsigned y=0;y<desc.Height;y++) memcpy(frame.data.data()+y*stride,static_cast<const uint8_t*>(mapped.pData)+y*mapped.RowPitch,stride);
    context->Unmap(staging.Get(),0); return frame;
  }
};
Frame gdi(RECT rect,HMONITOR monitor) {
  Frame frame; frame.width=static_cast<unsigned>(rect.right-rect.left); frame.height=static_cast<unsigned>(rect.bottom-rect.top); frame.color=monitorColor(monitor); frame.backend="gdi";
  // Do not silently reintroduce an 8-bit, clipped HDR image if float capture failed.
  if(frame.color.hdr) throw std::runtime_error("HDR capture unavailable; retry after closing other screen capture apps");
  HDC screen=GetDC(nullptr), memory=CreateCompatibleDC(screen); void* bits=nullptr;
  BITMAPINFO info{}; info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER); info.bmiHeader.biWidth=static_cast<LONG>(frame.width); info.bmiHeader.biHeight=-static_cast<LONG>(frame.height); info.bmiHeader.biPlanes=1; info.bmiHeader.biBitCount=32; info.bmiHeader.biCompression=BI_RGB;
  HBITMAP bitmap=CreateDIBSection(screen,&info,DIB_RGB_COLORS,&bits,nullptr,0);
  if(!screen || !memory || !bitmap) { if(bitmap) DeleteObject(bitmap); if(memory) DeleteDC(memory); if(screen) ReleaseDC(nullptr,screen); throw std::runtime_error("GDI capture failed"); }
  HGDIOBJ previous=SelectObject(memory,bitmap); const bool ok=BitBlt(memory,0,0,frame.width,frame.height,screen,rect.left,rect.top,SRCCOPY|CAPTUREBLT)!=0;
  if(ok) { frame.data.resize(static_cast<size_t>(frame.width)*frame.height*4); memcpy(frame.data.data(),bits,frame.data.size()); }
  SelectObject(memory,previous); DeleteObject(bitmap); DeleteDC(memory); ReleaseDC(nullptr,screen);
  if(!ok) throw std::runtime_error("Desktop is not accessible"); return frame;
}
std::vector<uint8_t> pixels(const Frame& frame, DXGI_MODE_ROTATION rotation) {
  const bool rotated=rotation==DXGI_MODE_ROTATION_ROTATE90 || rotation==DXGI_MODE_ROTATION_ROTATE270;
  const unsigned width=rotated ? frame.height : frame.width, height=rotated ? frame.width : frame.height;
  std::vector<uint8_t> result(static_cast<size_t>(width)*height*4);
  std::unique_ptr<capture::ColorTable> table;
  if(frame.format==DXGI_FORMAT_R16G16B16A16_FLOAT) table=std::make_unique<capture::ColorTable>(frame.color.hdr ? frame.color.whiteLevel/1000.0f : 1.0f);
  for(unsigned y=0;y<frame.height;y++) for(unsigned x=0;x<frame.width;x++) {
    unsigned tx=x,ty=y;
    if(rotation==DXGI_MODE_ROTATION_ROTATE90) { tx=frame.height-1-y; ty=x; }
    if(rotation==DXGI_MODE_ROTATION_ROTATE180) { tx=frame.width-1-x; ty=frame.height-1-y; }
    if(rotation==DXGI_MODE_ROTATION_ROTATE270) { tx=y; ty=frame.width-1-x; }
    auto* dest=result.data()+(static_cast<size_t>(ty)*width+tx)*4; const size_t index=static_cast<size_t>(y)*frame.width+x;
    if(table) table->pixel(reinterpret_cast<const uint16_t*>(frame.data.data())+index*4,dest);
    else {
      const auto* source=frame.data.data()+index*4;
      dest[0]=source[frame.format==DXGI_FORMAT_R8G8B8A8_UNORM ? 2 : 0]; dest[1]=source[1]; dest[2]=source[frame.format==DXGI_FORMAT_R8G8B8A8_UNORM ? 0 : 2]; dest[3]=255;
    }
  }
  return result;
}
std::vector<uint8_t> png(const std::vector<uint8_t>& bitmap,unsigned width,unsigned height,IWICImagingFactory* factory) {
  ComPtr<IStream> stream; require(CreateStreamOnHGlobal(nullptr,TRUE,stream.GetAddressOf()),"Image stream failed");
  ComPtr<IWICBitmapEncoder> encoder; require(factory->CreateEncoder(GUID_ContainerFormatPng,nullptr,encoder.GetAddressOf()),"PNG encoder failed"); require(encoder->Initialize(stream.Get(),WICBitmapEncoderNoCache),"PNG init failed");
  ComPtr<IWICBitmapFrameEncode> output; ComPtr<IPropertyBag2> options; require(encoder->CreateNewFrame(output.GetAddressOf(),options.GetAddressOf()),"PNG frame failed");
  require(output->Initialize(options.Get()),"PNG frame init failed"); require(output->SetSize(width,height),"PNG dimensions failed");
  WICPixelFormatGUID format=GUID_WICPixelFormat32bppBGRA; require(output->SetPixelFormat(&format),"PNG format failed");
  require(output->WritePixels(height,width*4,static_cast<UINT>(bitmap.size()),const_cast<BYTE*>(bitmap.data())),"PNG write failed"); require(output->Commit(),"PNG frame commit failed"); require(encoder->Commit(),"PNG commit failed");
  STATSTG stat{}; require(stream->Stat(&stat,STATFLAG_NONAME),"Image size failed");
  HGLOBAL memory=nullptr; require(GetHGlobalFromStream(stream.Get(),&memory),"PNG memory failed");
  auto* data=static_cast<const uint8_t*>(GlobalLock(memory)); if(!data) throw std::runtime_error("PNG lock failed");
  std::vector<uint8_t> result(data,data+static_cast<size_t>(stat.cbSize.QuadPart)); GlobalUnlock(memory); return result;
}
}
int main() {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  CoInitializeEx(nullptr,COINIT_MULTITHREADED);
  try {
    ComPtr<IWICImagingFactory> factory; require(CoCreateInstance(CLSID_WICImagingFactory,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(factory.GetAddressOf())),"WIC unavailable");
    std::map<HMONITOR,Duplication> caches;
    line("{\"event\":\"ready\"}");
    std::string command;
    while(std::getline(std::cin,command)) {
      if(command=="quit") break;
      if(command.rfind("prepare ",0)==0) {
        long x,y,width,height; std::istringstream input(command.substr(8));
        if(input>>x>>y>>width>>height) {
          RECT rect{x,y,x+width,y+height}; HMONITOR monitor=MonitorFromRect(&rect,MONITOR_DEFAULTTONEAREST);
          try { caches[monitor].init(monitor); } catch(...) { caches[monitor].reset(); }
        }
        continue;
      }
      unsigned id; long x,y,width,height; std::istringstream input(command);
      if(!(input>>id>>x>>y>>width>>height) || width<1 || height<1 || width>16384 || height>16384) continue;
      try {
        const auto start=Clock::now();
        RECT rect{x,y,x+width,y+height}; HMONITOR monitor=MonitorFromRect(&rect,MONITOR_DEFAULTTONEAREST);
        auto& cache=caches[monitor];
        // Synchronize just the compositor, instead of an arbitrary 90ms sleep.
        DwmFlush(); Frame frame;
        try { frame=cache.grab(monitor); } catch(...) { cache.reset(); frame=gdi(rect,monitor); }
        DXGI_MODE_ROTATION rotation=frame.backend==std::string("dxgi") ? cache.rotation : DXGI_MODE_ROTATION_IDENTITY;
        const bool rotated=rotation==DXGI_MODE_ROTATION_ROTATE90 || rotation==DXGI_MODE_ROTATION_ROTATE270;
        const unsigned outWidth=rotated ? frame.height : frame.width, outHeight=rotated ? frame.width : frame.height;
        line("{\"event\":\"frame\",\"id\":"+std::to_string(id)+",\"width\":"+std::to_string(outWidth)+",\"height\":"+std::to_string(outHeight)+",\"hdr\":"+(frame.color.hdr?"true":"false")+",\"whiteLevel\":"+std::to_string(frame.color.whiteLevel)+",\"backend\":\""+frame.backend+"\",\"format\":"+std::to_string(frame.format)+",\"present\":"+std::to_string(frame.present)+",\"accumulated\":"+std::to_string(frame.accumulated)+",\"captureMs\":"+std::to_string(elapsed(start))+"}");
        cache.staging.Reset(); // Only this request owns screen pixels.
        auto converted=pixels(frame,rotation); frame.data.clear(); auto encoded=png(converted,outWidth,outHeight,factory.Get());
        line("{\"event\":\"image\",\"id\":"+std::to_string(id)+",\"bytes\":"+std::to_string(encoded.size())+",\"totalMs\":"+std::to_string(elapsed(start))+"}"); writeAll(encoded.data(),encoded.size());
      } catch(const std::exception& error) { line("{\"event\":\"error\",\"id\":"+std::to_string(id)+",\"message\":\""+error.what()+"\"}"); }
    }
  } catch(...) { return 1; }
  return 0;
}
