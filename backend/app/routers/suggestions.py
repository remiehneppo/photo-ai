from fastapi import APIRouter

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])

PROMPTS_BY_TASK: dict[str, dict[str, list[str]]] = {
    "generate": {
        "realistic": [
            "a beautiful woman standing in a sunlit park, natural bokeh background",
            "professional headshot, clean white background, soft studio lighting",
            "street photography at golden hour, busy urban environment",
            "candid portrait in a coffee shop, warm ambient light, shallow depth of field",
            "mountaineer standing on a snowy peak at sunrise, dramatic sky",
        ],
        "anime": [
            "a cheerful anime girl with long blue hair in a school uniform, cherry blossoms",
            "samurai warrior standing in the rain, dramatic pose, detailed armor",
            "cute anime girl with fox ears in a magical glowing forest",
            "anime boy with silver hair standing in a cherry blossom garden at dusk",
            "two best friends laughing together in a cozy anime cafe",
        ],
        "advertisement": [
            "luxury perfume bottle on marble surface with gold light accents",
            "modern smartphone floating in mid-air with colorful light trails",
            "fresh orange juice splashing in slow motion on white background",
            "premium coffee cup with latte art, dark wood table, morning light",
            "fashion model wearing designer clothes against a minimalist white background",
        ],
        "portrait": [
            "close-up portrait of a woman with freckles in soft morning window light",
            "elderly man with weathered face and wise eyes, black and white",
            "young child laughing with joy outdoors in summer, natural light",
            "dramatic side-lit portrait of a man with strong features",
            "soft portrait of a woman among wildflowers at golden hour",
        ],
        "artistic": [
            "a lone knight standing before a dragon's cave, epic fantasy art, detailed",
            "surreal dreamscape with floating islands and waterfalls, concept art",
            "neon-lit cyberpunk city street at night with rain reflections",
            "magical forest with glowing mushrooms and dancing fairies, painterly",
            "abstract digital painting of human emotions in vibrant swirling colors",
        ],
        "natural": [
            "beautiful Korean woman in traditional hanbok at a cherry blossom temple",
            "a girl reading a book under a tree in an autumn forest",
            "serene woman meditating on a beach at sunrise, peaceful atmosphere",
            "a young woman with long hair standing in a golden wheat field at dusk",
            "friends having a picnic in a blooming flower meadow, candid moment",
        ],
    },
    "edit": {
        "background": [
            "change the background to a cozy coffee shop with warm lighting",
            "replace the background with a snowy mountain landscape",
            "put the subject on a white studio background",
            "change background to a bustling Tokyo street at night",
            "replace with a soft gradient sunset sky",
        ],
        "lighting": [
            "add warm golden hour sunlight from the left",
            "change to dramatic cinematic side lighting",
            "add soft diffused window light",
            "make it look like it was taken under neon lights at night",
            "add moody low-key studio lighting",
        ],
        "style transfer": [
            "make it look like a watercolor painting",
            "convert to black and white film photography style",
            "apply a vintage 1970s film look",
            "make it look like a charcoal sketch",
            "apply a vibrant pop-art color grading",
        ],
        "clothing": [
            "change outfit to an elegant black evening dress",
            "replace with a traditional Korean hanbok",
            "change clothing to a modern business suit",
            "add a cozy oversized winter sweater",
            "change to a casual summer outfit with light colors",
        ],
    },
    "inpaint": {
        "objects": [
            "a bouquet of red roses",
            "a fluffy white cat sitting naturally",
            "a wooden vintage suitcase",
            "a glowing magical lantern",
            "a cup of steaming coffee on a saucer",
        ],
        "people": [
            "a smiling child waving hello",
            "an elderly wise man with a long beard",
            "a person in a red coat walking away",
            "a dancer mid-leap in a graceful pose",
            "a chef holding a plate of gourmet food",
        ],
        "background": [
            "a lush green forest with dappled light",
            "a stormy dark sky with lightning",
            "a calm blue ocean at sunset",
            "a snowy winter landscape",
            "a cozy fireplace with warm flickering flames",
        ],
        "effects": [
            "soft golden bokeh lights",
            "floating cherry blossom petals",
            "magical sparkles and glowing particles",
            "falling autumn leaves",
            "soft morning fog drifting in",
        ],
    },
    "outpaint": {
        "nature": [
            "continue with a misty mountain range at dawn",
            "extend into a calm lake reflecting the sky",
            "add a dense ancient forest with tall trees",
            "continue with a wide open wildflower meadow",
            "extend into a rocky coastal cliff with ocean waves",
        ],
        "urban": [
            "add a modern city skyline at twilight",
            "continue with a rainy cobblestone European street",
            "extend into a busy Japanese street with neon signs",
            "add a quiet suburban neighborhood at sunset",
            "continue with an old-town alley with lanterns",
        ],
        "interior": [
            "extend into a cozy living room with bookshelves",
            "add a sunlit minimalist studio space",
            "continue with a luxurious hotel lobby",
            "extend into a warm rustic kitchen",
            "add a peaceful Japanese-style room with shoji screens",
        ],
        "sky": [
            "open up into a vast blue sky with fluffy clouds",
            "extend into a dramatic stormy sky with dark clouds",
            "add a breathtaking aurora borealis night sky",
            "continue with a vivid orange and purple sunset",
            "extend into a starry Milky Way night sky",
        ],
    },
}

STYLE_KEYWORDS: dict[str, list[str]] = {
    "anime": ["anime", "manga", "cartoon", "chibi", "kawaii", "otaku", "ghibli", "lineart", "monochrome", "samurai"],
    "portrait": ["portrait", "face", "close-up", "closeup", "headshot", "elderly", "child"],
    "advertisement": ["product", "commercial", "advertisement", "ad", "brand", "packaging", "luxury", "marketing", "bottle", "smartphone"],
    "artistic": ["painting", "art", "illustration", "concept art", "digital art", "fantasy", "dragon", "knight", "cyberpunk", "surreal", "magical", "neon"],
    "natural": ["hanbok", "korean", "asian", "traditional", "meadow", "picnic", "meditating"],
    "realistic": ["photo", "realistic", "photography", "cinematic", "studio", "candid", "street photography"],
}


@router.get("")
def get_suggestions():
    return {
        "prompts_by_task": PROMPTS_BY_TASK,
        "style_keywords": STYLE_KEYWORDS,
    }
