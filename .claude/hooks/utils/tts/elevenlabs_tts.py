#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "elevenlabs",
#     "python-dotenv",
#     "redis",
# ]
# ///

import os
import sys
import io
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path for imports
HOOKS_DIR = Path(__file__).parent.parent.parent
sys.path.insert(0, str(HOOKS_DIR))

# Load .env from project root (two levels up from .claude/hooks)
PROJECT_ROOT = HOOKS_DIR.parent.parent
load_dotenv(PROJECT_ROOT / '.env')

try:
    from utils.redis_cache import get_hook_cache
    CACHE_AVAILABLE = True
except ImportError:
    CACHE_AVAILABLE = False

def main():
    """
    ElevenLabs Flash v2.5 TTS Script

    Uses ElevenLabs' Flash v2.5 model for ultra-low latency text-to-speech (~75ms).
    Accepts optional text prompt as command-line argument.

    Usage:
    - ./eleven_turbo_tts.py                    # Uses default text
    - ./eleven_turbo_tts.py "Your custom text" # Uses provided text

    Features:
    - Ultra-low latency (~75ms - fastest model)
    - Optimized for real-time and conversational use
    - High-quality voice synthesis
    - Supports 32 languages
    - Cost-effective for high-volume usage
    """

    # Load environment variables
    load_dotenv()

    # Get API key from environment
    api_key = os.getenv('ELEVENLABS_API_KEY')
    if not api_key:
        print("❌ Error: ELEVENLABS_API_KEY not found in environment variables")
        print("Please add your ElevenLabs API key to .env file:")
        print("ELEVENLABS_API_KEY=your_api_key_here")
        sys.exit(1)

    try:
        from elevenlabs.client import ElevenLabs
        from elevenlabs.play import play

        # Initialize client
        elevenlabs = ElevenLabs(api_key=api_key)

        print("🎙️  ElevenLabs Flash v2.5 TTS")
        print("=" * 40)

        # Get text from command line argument or use default
        if len(sys.argv) > 1:
            text = " ".join(sys.argv[1:])  # Join all arguments as text
        else:
            text = "The first move is what sets everything in motion."

        print(f"🎯 Text: {text}")
        print("🔊 Generating and playing...")

        try:
            # Get voice ID from environment or use default (Rachel)
            voice_id = os.getenv('ELEVENLABS_VOICE_ID', '21m00Tcm4TlvDq8ikWAM')
            audio_bytes = None
            cache_hit = False

            # Check cache first
            if CACHE_AVAILABLE:
                cache = get_hook_cache()
                cached_audio = cache.get_cached_audio(text, voice_id)
                if cached_audio:
                    print("📦 Cache hit! Playing cached audio...")
                    audio_bytes = cached_audio
                    cache_hit = True

            # Generate audio if not cached
            if not audio_bytes:
                print("🔊 Generating audio...")
                audio_generator = elevenlabs.text_to_speech.convert(
                    text=text,
                    voice_id=voice_id,
                    model_id="eleven_flash_v2_5",
                    output_format="mp3_44100_128",
                )
                # Collect all bytes from generator
                audio_bytes = b''.join(audio_generator)

                # Cache the audio for future use
                if CACHE_AVAILABLE and audio_bytes:
                    cache = get_hook_cache()
                    if cache.cache_audio(text, audio_bytes, voice_id):
                        print("💾 Audio cached for future use")

            # Play the audio
            play(io.BytesIO(audio_bytes))
            print("✅ Playback complete!" + (" (from cache)" if cache_hit else ""))

        except Exception as e:
            print(f"❌ Error: {e}")


    except ImportError:
        print("❌ Error: elevenlabs package not installed")
        print("This script uses UV to auto-install dependencies.")
        print("Make sure UV is installed: https://docs.astral.sh/uv/")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
