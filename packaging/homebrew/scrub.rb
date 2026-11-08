class Scrub < Formula
  desc "Private reversible text and document anonymisation"
  homepage "https://github.com/onurkat/scrub-desktop"
  url "https://github.com/onurkat/scrub-desktop/releases/download/v1.0.3/scrub-desktop-1.0.3-source.tar.gz"
  sha256 "7b0fba82a255682f554e477f7bb7d93333849e1e8cf614d16fd2665f432fd4f6"
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
