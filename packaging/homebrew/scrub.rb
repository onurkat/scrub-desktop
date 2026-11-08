class Scrub < Formula
  desc "Private reversible text and document anonymisation"
  homepage "https://github.com/onurkat/scrub-desktop"
  url "https://github.com/onurkat/scrub-desktop/releases/download/v1.0.2/scrub-desktop-1.0.2-source.tar.gz"
  sha256 "0712988848c32a514631a2651f9f86d15316d0a4c74707e910eb5725a224ca32"
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
