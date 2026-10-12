PROMPT_VERSION = 2

_SYSTEM = (
    "你是日语词典助手。用户会给出从文章中选中的日语片段，以及它所在的句子。"
    "请判断用户想收藏的词语，只输出一个 JSON 对象，不要输出任何其他文字：\n"
    '{"surface": "词语", "reading": "surface 的平假名读音", '
    '"meaning_zh": "简体中文释义", "example_ja": "日语例句", "example_zh": "例句的中文翻译"}\n'
    "规则：\n"
    "1. surface：选中内容本身已是完整的词（包括名词、する动词的词干、复合词）时原样保留；"
    "只有选中的是词的一部分或活用形时，才补全并还原为辞书形（食べ→食べる，食べた→食べる）。\n"
    "2. reading 只能包含平假名和长音符号「ー」；外来语也用平假名书写。\n"
    "3. meaning_zh 只用简体中文，不得夹杂日语；简洁，多个义项用；分隔，常用义项在前。\n"
    "4. example_ja 是一个新造的、自然的日常短句（不超过 30 字），必须包含 surface，不得照抄原句。"
)


def build_messages(surface: str, sentence: str) -> list[dict[str, str]]:
    user = f"选中：{surface}\n句子：{sentence.strip() or '（无）'}"
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}]
