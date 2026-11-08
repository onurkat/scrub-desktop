# Flathub preparation

The manifest is a local source-tree preparation, not a submission. Before submitting a tagged release, generate npm and Cargo source lists with the official flatpak-builder-tools generators, include those lists in `sources`, and replace the local directory source with the tagged release and its verified checksum. Build with networking disabled; runtime network permission is intentionally absent.

Wayland shortcuts are compositor-assigned commands. Clipboard availability depends on the compositor's clipboard protocol; see QA.md for tested environments. File access uses native chooser dialogs rather than a broad filesystem grant.
