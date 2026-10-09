The Codex inside Edward
=======================

The folder above this one is OpenAI's Codex CLI, the program Edward talks to the AI through. It is
OpenAI's own release package for this system, in the version codex-package.json names, as downloaded
from https://github.com/openai/codex/releases and checked against its SHA-256 when Edward was built.
One part was left out: codex-resources/voice (Codex's own voice feature, which Edward doesn't use).
Nothing else was changed; on a Mac its programs are signed again as part of Edward's app, as
everything inside an app is.

Edward is not made by, or affiliated with, OpenAI.

Licences
--------

Codex            Apache License 2.0     LICENSE and NOTICE in this folder
                 Source: https://github.com/openai/codex

ripgrep          MIT (or the Unlicense) ripgrep-LICENSE-MIT in this folder
(codex-path/rg)  Source: https://github.com/BurntSushi/ripgrep

zsh              zsh's own licence      zsh-LICENCE in this folder
(macOS only,     Source: https://sourceforge.net/p/zsh/code
codex-resources/zsh)
