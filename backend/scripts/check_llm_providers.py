#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_ROOT))

from agent_core import _call_provider  # type: ignore


CHECK_PROMPT = "Reply with exactly: OK"


def run_provider_check(provider_name: str) -> tuple[bool, str]:
    try:
        raw = _call_provider(provider_name, CHECK_PROMPT, CHECK_PROMPT)
        if not raw or not raw.strip():
            return False, f"Provider {provider_name} returned empty response"
        return True, raw.strip()
    except Exception as exc:
        return False, repr(exc)


def main() -> int:
    print("Checking LLM providers...")
    sarvam_ok, sarvam_result = run_provider_check("sarvam")
    print("SARVAM:", "OK" if sarvam_ok else "FAIL")
    print(sarvam_result)
    print()

    gemini_ok, gemini_result = run_provider_check("gemini")
    print("GEMINI:", "OK" if gemini_ok else "FAIL")
    print(gemini_result)
    print()

    if sarvam_ok or gemini_ok:
        print("At least one provider is healthy.")
        return 0
    print("Both providers failed.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
