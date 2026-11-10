class ScrubDesktop < Formula
  desc "Local clipboard anonymisation in your menu bar"
  homepage "https://github.com/onurkat/scrub-desktop"
  url "https://github.com/onurkat/scrub-desktop/releases/download/v1.0.4/scrub-desktop-1.0.4-source.tar.gz"
  sha256 "9be3cbf27b509aa408d5341c84c7b80d455b42b0c02f4cac91feb63c5c4000b5"
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
