"""App API bridge: lets another app's premium backend translate on behalf of
one of its own callers, reusing that caller's own DeepL key stored here.
Not on the critical path for RSS Reader or Nostradamus, which call
/pub/deepl/translate directly from their public frontend with the visitor's
own X-Pub-Token — this exists for future server-to-server integrations."""

import sys


def _pub():
    return sys.modules.get("app_public_deepl")


def translate(user_id: str, text: str, target_lang: str, source_lang: str = None):
    """Translate text using user_id's own stored DeepL API key.

    Returns {"translated_text": ..., "source_lang": ..., "target_lang": ...}
    or {"error": "..."} if the user has no key saved or DeepL rejects the call.
    """
    pub = _pub()
    if not pub:
        return {"error": "deepl_unavailable"}
    api_key = pub.get_key(user_id)
    if not api_key:
        return {"error": "api_key_missing"}
    text = (text or "").strip()
    if not text:
        return {"error": "empty_text"}
    if len(text) > pub._MAX_TEXT_LEN:
        return {"error": "text_too_long"}
    try:
        translated, detected_source = pub.call_deepl(api_key, text, target_lang, source_lang)
    except ValueError as exc:
        return {"error": str(exc)}
    resolved_source = source_lang or detected_source
    pub._record_history(user_id, resolved_source, target_lang.upper(), text, translated)
    return {"translated_text": translated, "source_lang": resolved_source, "target_lang": target_lang.upper()}
