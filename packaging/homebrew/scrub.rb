class Scrub < Formula
  desc "Private reversible text and document anonymisation"
  homepage "https://github.com/onurkat/scrub-desktop"
  url "https://github.com/onurkat/scrub-desktop/releases/download/v1.0.1/scrub-desktop-1.0.1-source.tar.gz"
  sha256 "ba4d9cdea1b3323157be6057c7029ec16637e562d535b3919de95ee3ce94970e"
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
