"""Check that a language model provider answers a small structured request.

Sends no evaluation data: only a fixed sentence. Prints the outcome, the time taken and the tokens.

    python -m scripts.llm_smoke_test                       # the deployment's AI_* / OPENAI_* settings
    python -m scripts.llm_smoke_test --provider anthropic --model claude-sonnet-5-5 --key-env ANTHROPIC_API_KEY
    python -m scripts.llm_smoke_test --provider openai_compatible --model deepseek-chat \\
        --base-url https://api.deepseek.com --key-env DEEPSEEK_API_KEY --json-mode object
"""
import argparse
import os
import sys

from pydantic import BaseModel, ConfigDict

from integrations import llm


class SmokeAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: str
    word_count: int


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--provider", choices=llm.PROVIDERS)
    parser.add_argument("--model")
    parser.add_argument("--key-env", help="name of the environment variable that holds the API key")
    parser.add_argument("--base-url")
    parser.add_argument("--json-mode", choices=("schema", "object"), default="schema")
    args = parser.parse_args()
    try:
        if args.provider:
            key = os.getenv(args.key_env or "AI_API_KEY", "").strip()
            if not key or not args.model:
                print("Give --model and an environment variable with the key (--key-env).")
                return 2
            chosen = llm.LLMSettings(provider=args.provider, model=args.model, api_key=key,
                                     base_url=args.base_url, json_mode=args.json_mode)
        else:
            chosen = llm.settings()
        result = llm.provider_for(chosen).generate_structured(
            instructions=["Report the language of the user's sentence and how many words it has."],
            user="A teljesítményértékelés minden negyedévben lezajlik.",
            schema=SmokeAnswer, temperature=0.2, retries=0)
    except llm.LLMError as error:
        print(f"FAILED: {error.category}{' (' + ', '.join(error.detail) + ')' if error.detail else ''}")
        return 1
    print(f"OK: {result.provider} / {result.model}: {result.parsed.model_dump()} "
          f"in {result.latency_ms} ms, {result.input_tokens} input + {result.output_tokens} output tokens")
    return 0


if __name__ == "__main__":
    sys.exit(main())
