from tts_engine import TTSEngine

# See CLAUDE.md "Voice settings (locked)" and tts_engine.py for the pipeline
# details (reference cloning, chunking, generation params). This script is
# just a one-off CLI generation using those settings.
#
# [chuckle] is a real Turbo/Nano paralinguistic tag; [pause] is not (read
# literally as the word "pause"), and *asterisk* emphasis isn't supported
# markup either - both avoided here.
text = "Hey I'm Stu! I am so glad you could make it! [chuckle] I was worried you might not show up... But hey, no worries, right? Let's get started!"

engine = TTSEngine()
engine.generate_to_file(text, "test-turbo.mp3")
