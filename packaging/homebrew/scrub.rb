class Scrub < Formula
  desc "Private reversible text and document anonymisation"
  homepage "https://github.com/onurkat/scrub-desktop"
  url "https://github.com/onurkat/scrub-desktop/releases/download/v1.0.4/scrub-desktop-1.0.4-source.tar.gz"
  sha256 "9be3cbf27b509aa408d5341c84c7b80d455b42b0c02f4cac91feb63c5c4000b5"
  license "GPL-3.0-or-later"
  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_equal "[EMAIL_1]", pipe_output(bin/"scrub", "test@example.com").strip
  end
end
