class Scrub < Formula
  desc "Private reversible text and document anonymisation"
  homepage "https://github.com/onurkat/scrub-desktop"
  url "https://github.com/onurkat/scrub-desktop/releases/download/v1.0.0/scrub-desktop-1.0.0-source.tar.gz"
  version "1.0.0"
  sha256 "24b58245c5c1c0b751dc7b294a1352654e442858456039fabbd7240b14924447"
  license "GPL-3.0-or-later"
  depends_on "node"

  def install
    system "npm", "ci", "--omit=dev", "--ignore-scripts"
    system "npm", "pack", "--ignore-scripts"
    system "npm", "install", "--global", "--prefix", libexec, "--ignore-scripts", "onurkat-scrub-1.0.0.tgz"
    bin.install_symlink libexec/"bin/scrub"
  end

  test do
    assert_equal "[EMAIL_1]", pipe_output("#{bin}/scrub", "test@example.com").strip
  end
end
