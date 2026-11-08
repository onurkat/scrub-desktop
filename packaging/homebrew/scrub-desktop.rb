class ScrubDesktop < Formula
  desc "Local clipboard anonymisation in your menu bar"
  homepage "https://github.com/onurkat/scrub-desktop"
  url "https://github.com/onurkat/scrub-desktop/releases/download/v1.0.3/scrub-desktop-1.0.3-source.tar.gz"
  sha256 "14ba1bb0589f38d8bbc3d3b9a87891f5e8b599dfd1829101735d19c770fdff1b"
  license "GPL-3.0-or-later"
  depends_on "node" => :build
  depends_on "rust" => :build
  depends_on :macos

  def install
    system "npm", "ci"
    system "npx", "tauri", "build", "--bundles", "app"
    prefix.install "src-tauri/target/release/bundle/macos/Scrub.app"
    (bin/"scrub-desktop").write <<~SH
      #!/bin/sh
      exec "#{prefix}/Scrub.app/Contents/MacOS/scrub-desktop" "$@"
    SH
  end

  def caveats
    <<~EOS
      Link the locally built application into Applications:
        ln -s #{prefix}/Scrub.app /Applications/Scrub.app
      Scrub runs in the menu bar. Start at login is opt-in in Settings.
    EOS
  end

  test do
    system bin/"scrub-desktop", "--self-test"
  end
end
