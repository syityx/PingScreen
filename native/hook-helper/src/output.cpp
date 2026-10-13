#include "output.h"

#include "json.h"

namespace lp {

std::string formatEmit(const Emit& e) {
  auto pt = [&](const char* type) {
    return std::string("{\"type\":\"") + type + "\",\"x\":" + std::to_string(e.x) + ",\"y\":" + std::to_string(e.y) +
           ",\"wheel\":\"" + (e.wheel == WheelKind::Emote ? "emote" : "ping") + "\"}";
  };
  switch (e.kind) {
    case Emit::Kind::WheelOpen: return pt("wheelOpen");
    case Emit::Kind::WheelMove: return pt("wheelMove");
    case Emit::Kind::WheelRelease: return pt("wheelRelease");
    case Emit::Kind::WheelScroll: {
      auto text=pt("wheelScroll"); text.pop_back(); return text+",\"delta\":"+std::to_string(e.delta)+"}";
    }
    case Emit::Kind::Click: return pt("click");
    case Emit::Kind::Cancel: return "{\"type\":\"cancel\"}";
    case Emit::Kind::Toggled: return std::string("{\"type\":\"toggled\",\"enabled\":") + (e.enabled ? "true" : "false") + "}";
  }
  return "{}";
}

Output::Output(Writer writer, size_t maxQueued) : writer_(std::move(writer)), max_(maxQueued), thread_([this] { run(); }) {}

Output::~Output() { stop(); }

void Output::line(std::string s) {
  {
    std::lock_guard<std::mutex> lk(mu_);
    if (stopping_) return;
    if (q_.size() >= max_) {
      ++dropped_;
      return;
    }
    q_.push_back(std::move(s));
  }
  cv_.notify_one();
}

void Output::emit(const Emit& e) {
  if(e.kind!=Emit::Kind::WheelMove) { line(formatEmit(e)); return; }
  {
    std::lock_guard<std::mutex> lk(mu_);
    if(stopping_) return;
    const auto text=formatEmit(e);
    // A slow reader only needs the newest consecutive move. Keep gesture
    // boundaries in order so a flood cannot delay release/cancel behind moves.
    if(!q_.empty() && q_.back().rfind("{\"type\":\"wheelMove\"",0)==0) q_.back()=text;
    else if(q_.size()<max_) q_.push_back(text);
    else { ++dropped_; return; }
  }
  cv_.notify_one();
}

// Version 3 adds signed wheel-scroll events while a gesture is open.
void Output::ready() { line("{\"type\":\"ready\",\"version\":3}"); }

void Output::error(const std::string& message) { line("{\"type\":\"error\",\"message\":\"" + jsonEscape(message) + "\"}"); }

void Output::error(const std::string& code, const std::string& message) {
  line("{\"type\":\"error\",\"code\":\"" + jsonEscape(code) + "\",\"message\":\"" + jsonEscape(message) + "\"}");
}

void Output::stop() {
  {
    std::lock_guard<std::mutex> lk(mu_);
    stopping_ = true;
  }
  cv_.notify_one();
  if (thread_.joinable()) thread_.join();
}

size_t Output::dropped() const {
  std::lock_guard<std::mutex> lk(mu_);
  return dropped_;
}

void Output::run() {
  std::unique_lock<std::mutex> lk(mu_);
  while (true) {
    cv_.wait(lk, [this] { return !q_.empty() || stopping_; });
    if (q_.empty()) return;  // stopping and fully drained
    std::string s = std::move(q_.front());
    q_.pop_front();
    lk.unlock();
    const bool ok = writer_(s);
    lk.lock();
    if (!ok) {  // Electron is gone: drop the rest
      dropped_ += q_.size();
      q_.clear();
      stopping_ = true;
      return;
    }
  }
}

}  // namespace lp
