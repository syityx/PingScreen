#include "../src/color.h"
#include <iostream>
int main() {
  int failed = 0;
  auto check = [&](bool ok, const char* label) { if (!ok) { ++failed; std::cerr << label << '\n'; } };
  check(capture::halfFloat(0x3c00) == 1.0f, "half one");
  check(capture::halfFloat(0x4000) == 2.0f, "half two");
  check(capture::srgb(0) == 0 && capture::srgb(1) == 255, "black and white");
  check(capture::srgb(0.18f) >= 117 && capture::srgb(0.18f) <= 119, "sRGB gamma");
  uint8_t pixel[4];
  uint16_t white[] = {0x4000,0x4000,0x4000,0x3c00};
  capture::floatPixel(white,2,pixel);
  check(pixel[0] == 255 && pixel[1] == 255 && pixel[2] == 255 && pixel[3] == 255, "SDR white level normalization");
  uint16_t gray[] = {0x3800,0x3800,0x3800,0x3c00};
  capture::floatPixel(gray,2,pixel);
  check(pixel[0] >= 136 && pixel[0] <= 138, "HDR desktop gray isn't clipped or double-gamma encoded");
  uint16_t hdr[] = {0x4400,0x4000,0x3c00,0x3c00};
  capture::floatPixel(hdr,1,pixel);
  check(pixel[2] == 255 && pixel[1] == 188 && pixel[0] == 137, "highlight hue preservation");
  uint16_t invalid[] = {0x7c00,0x7e00,0xbc00,0};
  capture::floatPixel(invalid,1,pixel);
  check(pixel[0] == 0 && pixel[1] == 0 && pixel[2] == 0 && pixel[3] == 255, "invalid float and alpha handling");
  for(float whiteScale : {1.0f,2.0f,3.85f}) {
    capture::ColorTable table(whiteScale); bool equal=true;
    for(unsigned h=0;h<65536;h++) {
      uint16_t rgba[]={static_cast<uint16_t>(h),static_cast<uint16_t>((h*7)%65536),static_cast<uint16_t>((h*13)%65536),0};
      uint8_t expected[4],actual[4]; capture::floatPixel(rgba,whiteScale,expected); table.pixel(rgba,actual);
      if(memcmp(expected,actual,4)!=0) { equal=false; break; }
    }
    check(equal,"lookup conversion matches reference for every half-float at SDR/HDR white levels");
  }
  std::cout << (11-failed) << " color tests passed, " << failed << " failed\n";
  return failed ? 1 : 0;
}
