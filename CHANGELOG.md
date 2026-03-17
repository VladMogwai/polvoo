# Changelog

## v1.0.5
### New Features
- Added Settings panel with macOS permissions overview
- Added drag and drop file path insertion into terminal
- Added localhost URL badges on project cards and right panel
- Added single instance lock (prevents multiple app windows)
- Added auto-scroll to bottom when new terminal output arrives
- Added CHANGELOG.md with full version history
- Added automatic release notes from git commits

### Bug Fixes
- Fixed port detection showing system ports instead of project ports
- Fixed process showing "Error" status on manual stop
- Fixed false "Error" status when project stops normally (concurrently exit code 1)
- Fixed "Error" shown when dev process exits cleanly with code 0
- Fixed logs not showing when process crashes
- Fixed kill button in Process Monitor not working
- Fixed project switching destroying terminal sessions and killing processes
- Fixed terminal showing empty when opened after process already started
- Fixed port input field causing port reset on blur
- Fixed app crashing when clicking project after recent changes
