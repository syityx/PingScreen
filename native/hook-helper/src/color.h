#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <array>

namespace capture {
inline float halfFloat(uint16_t h) {
  const unsigned exponent = (h >> 10) & 31, mantissa = h & 1023;
  const float sign = (h & 32768) ? -1.0f : 1.0f;
  if (exponent == 0) return sign * std::ldexp(static_cast<float>(mantissa), -24);
  if (exponent == 31) return 0; // NaN/Infinity must not contaminate the image.
  return sign * std::ldexp(1.0f + static_cast<float>(mantissa) / 1024, static_cast<int>(exponent) - 15);
}
inline uint8_t srgb(float linear) {
  linear = std::clamp(linear, 0.0f, 1.0f);
  const float encoded = linear <= 0.0031308f ? 12.92f * linear : 1.055f * std::pow(linear, 1.0f / 2.4f) - 0.055f;
  return static_cast<uint8_t>(std::lround(encoded * 255));
}
inline void floatPixel(const uint16_t* rgba, float whiteScale, uint8_t* bgra) {
  float r = std::max(0.0f, halfFloat(rgba[0]) / whiteScale);
  float g = std::max(0.0f, halfFloat(rgba[1]) / whiteScale);
  float b = std::max(0.0f, halfFloat(rgba[2]) / whiteScale);
  // scRGB 1.0 = 80 nits; Windows' SDR white is not necessarily 80 nits.
  // Preserve SDR pixels exactly. Compress HDR highlights with a common scale,
  // avoiding independent channel clipping that changes the hue.
  const float peak = std::max({r,g,b,1.0f});
  bgra[0] = srgb(b / peak); bgra[1] = srgb(g / peak); bgra[2] = srgb(r / peak); bgra[3] = 255;
}
// Most desktop pixels are SDR UI values in an HDR compositor. Decode their
// half-floats and gamma once per white level, rather than pow() per channel.
class ColorTable {
  std::array<float,65536> linear_{};
  std::array<uint8_t,65536> encoded_{};
 public:
  explicit ColorTable(float whiteScale) {
    for(unsigned h=0;h<65536;h++) { linear_[h]=std::max(0.0f,halfFloat(static_cast<uint16_t>(h))/whiteScale); encoded_[h]=srgb(linear_[h]); }
  }
  void pixel(const uint16_t* rgba,uint8_t* bgra) const {
    const float peak=std::max({linear_[rgba[0]],linear_[rgba[1]],linear_[rgba[2]],1.0f});
    if(peak==1.0f) { bgra[0]=encoded_[rgba[2]]; bgra[1]=encoded_[rgba[1]]; bgra[2]=encoded_[rgba[0]]; }
    else { bgra[0]=srgb(linear_[rgba[2]]/peak); bgra[1]=srgb(linear_[rgba[1]]/peak); bgra[2]=srgb(linear_[rgba[0]]/peak); }
    bgra[3]=255;
  }
};
}
