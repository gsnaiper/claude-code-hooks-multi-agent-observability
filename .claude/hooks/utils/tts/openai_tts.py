#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "openai",
#     "openai[voice_helpers]",
#     "python-dotenv",
#     "redis",
# ]
# ///

import os
import sys
import asyncio
import io
import tempfile
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

try:
    from utils.redis_cache import get_hook_cache
    CACHE_AVAILABLE = True
except ImportError:
    CACHE_AVAILABLE = False


async def main():
    """
    OpenAI TTS Script

    Uses OpenAI's latest TTS model for high-quality text-to-speech.
    Accepts optional text prompt as command-line argument.

    Usage:
    - ./openai_tts.py                    # Uses default text
    - ./openai_tts.py "Your custom text" # Uses provided text

    Features:
    - OpenAI gpt-4o-mini-tts model (latest)
    - Nova voice (engaging and warm)
    - Streaming audio with instructions support
    - Live audio playback via LocalAudioPlayer
    """

    # Load environment variables
    load_dotenv()

    # Get API key from environment
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("❌ Error: OPENAI_API_KEY not found in environment variables")
        print("Please add your OpenAI API key to .env file:")
        print("OPENAI_API_KEY=your_api_key_here")
        sys.exit(1)

    try:
        from openai import AsyncOpenAI
        from openai.helpers import LocalAudioPlayer

        # Initialize OpenAI client
        openai = AsyncOpenAI(api_key=api_key)

        print("🎙️  OpenAI TTS")
        print("=" * 20)

        # Get text from command line argument or use default
        if len(sys.argv) > 1:
            text = " ".join(sys.argv[1:])  # Join all arguments as text
        else:
            text = "Today is a wonderful day to build something people love!"

        print(f"🎯 Text: {text}")

        voice = "nova"
        audio_bytes = None
        cache_hit = False

        # Check cache first
        if CACHE_AVAILABLE:
            cache = get_hook_cache()
            cached_audio = cache.get_cached_audio(text, f"openai-{voice}")
            if cached_audio:
                print("📦 Cache hit! Playing cached audio...")
                audio_bytes = cached_audio
                cache_hit = True

        try:
            if audio_bytes:
                # Play cached audio using temp file
                with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
                    f.write(audio_bytes)
                    temp_path = f.name
                try:
                    import subprocess
                    # Use ffplay or similar to play the audio
                    subprocess.run(['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', temp_path],
                                   capture_output=True, timeout=30)
                except (FileNotFoundError, subprocess.TimeoutExpired):
                    # Fallback: try mpv
                    try:
                        subprocess.run(['mpv', '--no-video', temp_path],
                                       capture_output=True, timeout=30)
                    except (FileNotFoundError, subprocess.TimeoutExpired):
                        print("⚠️ Could not play cached audio (no player found)")
                finally:
                    os.unlink(temp_path)
            else:
                print("🔊 Generating audio...")
                # Generate audio using OpenAI TTS (non-streaming for caching)
                response = await openai.audio.speech.create(
                    model="gpt-4o-mini-tts",
                    voice=voice,
                    input=text,
                    instructions="Speak in a cheerful, positive yet professional tone.",
                    response_format="mp3",
                )
                audio_bytes = response.content

                # Cache the audio for future use
                if CACHE_AVAILABLE and audio_bytes:
                    cache = get_hook_cache()
                    if cache.cache_audio(text, audio_bytes, f"openai-{voice}"):
                        print("💾 Audio cached for future use")

                # Play the generated audio via temp file
                with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
                    f.write(audio_bytes)
                    temp_path = f.name
                try:
                    import subprocess
                    subprocess.run(['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', temp_path],
                                   capture_output=True, timeout=30)
                except (FileNotFoundError, subprocess.TimeoutExpired):
                    try:
                        subprocess.run(['mpv', '--no-video', temp_path],
                                       capture_output=True, timeout=30)
                    except (FileNotFoundError, subprocess.TimeoutExpired):
                        # Last resort: try LocalAudioPlayer with streaming
                        async with openai.audio.speech.with_streaming_response.create(
                            model="gpt-4o-mini-tts",
                            voice=voice,
                            input=text,
                            instructions="Speak in a cheerful, positive yet professional tone.",
                            response_format="mp3",
                        ) as stream_response:
                            await LocalAudioPlayer().play(stream_response)
                finally:
                    if os.path.exists(temp_path):
                        os.unlink(temp_path)

            print("✅ Playback complete!" + (" (from cache)" if cache_hit else ""))

        except Exception as e:
            print(f"❌ Error: {e}")

    except ImportError as e:
        print("❌ Error: Required package not installed")
        print("This script uses UV to auto-install dependencies.")
        print("Make sure UV is installed: https://docs.astral.sh/uv/")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())