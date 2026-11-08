class Scrub < Formula
  desc "Private reversible text and document anonymisation"
  homepage "https://github.com/onurkat/scrub-desktop"
  url "https://github.com/onurkat/scrub-desktop/releases/download/v1.0.0/scrub-desktop-1.0.0-source.tar.gz"
  sha256 "a1c81d14aa7dbefd88b0026d4f206d1cb1636428b1eb8184f9279826c51ae228"
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
