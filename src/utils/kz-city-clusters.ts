// Определение крупного города по адресу организации/аптеки для аналитики
// по регионам. Логика — агломерации: крупный город поглощает спутники,
// районы и (если нет ни города, ни района) свою область.
//
// Приоритет разбора: явный город → район → спутник → область.
// Таблицы утверждены пользователем на реальных адресах (32 шт., см. отчёт
// в переписке) + 4 синтетических теста на коллизию районов Актобе.

// ---------- Таблица 1: города-спутники → крупный город ----------
const CITY_CLUSTERS: Record<string, string[]> = {
    'Кокшетау': ['Атбасар', 'Есиль', 'Макинск', 'Степняк', 'Щучинск'],
    'Актау': ['Жанаозен', 'Форт-Шевченко'],
    'Актобе': ['Алга', 'Жем', 'Кандыагаш', 'Кандагаш', 'Темир', 'Хромтау', 'Шалкар', 'Эмба'],
    'Алматы': ['Алатау', 'Есик', 'Жаркент', 'Каскелен', 'Конаев', 'Сарканд', 'Талгар', 'Талдыкорган', 'Текели', 'Ушарал', 'Уштобе', 'Чунжа', 'Чилик', 'Узынагаш'],
    'Астана': ['Косшы', 'Нур-Султан', 'Степногорск', 'Акколь', 'Шортанды', 'Караоткель'],
    'Атырау': ['Кулсары'],
    'Караганда': ['Балхаш', 'Жезказган', 'Каражал', 'Каркаралинск', 'Приозёрск', 'Сарань', 'Сатпаев', 'Темиртау', 'Шахтинск'],
    'Костанай': ['Аркалык', 'Аулиеколь', 'Житикара', 'Затобольск', 'Лисаковск', 'Рудный', 'Тобыл'],
    'Павлодар': ['Аксу', 'Экибастуз'],
    'Петропавловск': ['Булаево', 'Мамлютка', 'Сергеевка', 'Тайынша'],
    'Семей': ['Абай', 'Аягоз', 'Курчатов', 'Шемонаиха'],
    'Тараз': ['Жанатас', 'Каратау', 'Шу'],
    'Уральск': ['Аксай'],
    'Усть-Каменогорск': ['Алтай', 'Зайсан', 'Риддер', 'Серебрянск', 'Шар'],
    'Шымкент': ['Арыс', 'Жетысай', 'Казалинск', 'Кентау', 'Ленгер', 'Сарыагаш', 'Шардара', 'Кордай'],
}

// Казахские написания головных городов — синонимы, не спутники.
const CITY_SYNONYMS: Record<string, string> = {
    'оскемен': 'Усть-Каменогорск',
    'караганды': 'Караганда',
}

// ---------- Таблица 2: район → город ----------
const DISTRICT_TO_CITY: Record<string, string> = {
    // Астана: 5 районов + Целиноградский район Акмолинской обл. (агломерация)
    'есиль': 'Астана', 'алматы': 'Астана', 'байконыр': 'Астана', 'байқоңыр': 'Астана',
    'нура': 'Астана', 'нұра': 'Астана', 'сарыарка': 'Астана',
    'целиноградский': 'Астана',
    // Алматы: 8 районов
    'медеуский': 'Алматы', 'ауэзовский': 'Алматы', 'алмалинский': 'Алматы', 'бостандыкский': 'Алматы',
    'наурызбайский': 'Алматы', 'турксибский': 'Алматы', 'жетысуский': 'Алматы', 'алатауский': 'Алматы',
    // Шымкент: 5 районов
    'аль-фарабийский': 'Шымкент', 'әл-фараби': 'Шымкент', 'абайский': 'Шымкент',
    'енбекшинский': 'Шымкент', 'каратауский': 'Шымкент', 'туран': 'Шымкент',
    // Караганда: 2 района
    'қазыбек би': 'Караганда', 'казыбек би': 'Караганда', 'октябрьский': 'Караганда',
}

// "Алматы" и "Астана" — названия районов не только столиц, но и Актобе
// (Астана ауданы, Алматы ауданы). "алматы" сам по себе — легитимный район
// Астаны (разрешается в неё по умолчанию); "астана" не является районом ни
// одного города и разрешается ТОЛЬКО при явном контексте Актобе рядом.
const AKTOBE_DISTRICTS = new Set(['алматы', 'астана'])

// ---------- Таблица 3: область → административный центр ----------
// Последний приоритет — только если не найдено ни города, ни района.
const OBLAST_TO_CENTER: Record<string, string> = {
    'акмолинская': 'Кокшетау',
    'актюбинская': 'Актобе',
    'алматинская': 'Конаев',
    'атырауская': 'Атырау',
    'восточно-казахстанская': 'Усть-Каменогорск',
    'абайская': 'Семей',
    'жамбылская': 'Тараз',
    'западно-казахстанская': 'Уральск',
    'карагандинская': 'Караганда',
    'костанайская': 'Костанай',
    'кызылординская': 'Кызылорда',
    'мангистауская': 'Актау',
    'павлодарская': 'Павлодар',
    'северо-казахстанская': 'Петропавловск',
    'туркестанская': 'Туркестан',
    'улытауская': 'Жезказган',
    'жетысуская': 'Талдыкорган',
}

const CITY_NAME_TO_CANONICAL = new Map<string, string>()
for (const city of Object.keys(CITY_CLUSTERS)) CITY_NAME_TO_CANONICAL.set(city.toLowerCase(), city)
for (const [syn, city] of Object.entries(CITY_SYNONYMS)) CITY_NAME_TO_CANONICAL.set(syn, city)

// Казахские буквы -> ближайшие кириллические аналоги, для сопоставления
// вне зависимости от написания (Байконыр/Байқоңыр, Нура/Нұра и т.п.).
const stripKzLetters = (s: string): string =>
    s
        .replace(/[қ]/g, 'к').replace(/[ұ]/g, 'у').replace(/[ә]/g, 'а')
        .replace(/[ө]/g, 'о').replace(/[і]/g, 'и').replace(/[ң]/g, 'н')
        .replace(/[ғ]/g, 'г').replace(/[һ]/g, 'х')

// Кириллический класс символов для границ слова. \b в JS regex работает
// только через ASCII \w и НЕ распознаёт границы вокруг кириллицы/казахских
// букв — вместо него везде ниже используется (^|[^KZ_CLASS]) / (?![KZ_CLASS]).
const KZ_CLASS = 'а-яёa-zқұәөіңғһ'

const findByWordBoundary = (haystackLower: string, name: string): boolean => {
    const re = new RegExp(`(^|[^${KZ_CLASS}])${name}(?![${KZ_CLASS}])`, 'iu')
    return re.test(haystackLower)
}

const precededByDistrictMarker = (haystack: string, matchIndex: number): boolean => {
    const before = haystack.slice(0, matchIndex)
    return /(?:р-н|р-он|район)\.?\s*$/iu.test(before)
}

// Извлекает название населённого пункта/района/области из адреса
// организации и определяет, к какому крупному городу он относится.
export const deriveCityAndAddress = (
    rawAddress: string | null | undefined
): { city: string; address: string } => {
    const address = (rawAddress || '').trim()
    if (!address) return { city: '', address: '' }

    const lower = address.toLowerCase()
    const lowerNorm = stripKzLetters(lower)

    // --- Приоритет 1: явный город ("г. X", "X Г.А.", город первым сегментом) ---
    let m = address.match(/г\.\s*([А-ЯЁӘҒҚҢӨҰҮҺІа-яёәғқңөұүһі-]+)/iu)
    if (m) {
        const candidate = m[1].toLowerCase()
        const canon = CITY_NAME_TO_CANONICAL.get(candidate) || CITY_NAME_TO_CANONICAL.get(stripKzLetters(candidate))
        if (canon) return { city: canon, address }
    }
    m = address.match(/([А-ЯЁӘҒҚҢӨҰҮҺІа-яёәғқңөұүһі-]+)\s+Г\.А\./u)
    if (m) {
        const candidate = m[1].toLowerCase()
        const canon = CITY_NAME_TO_CANONICAL.get(candidate) || CITY_NAME_TO_CANONICAL.get(stripKzLetters(candidate))
        if (canon) return { city: canon, address }
    }
    // Без префикса "г."/суффикса "Г.А.": название крупного города — целиком
    // первый сегмент строки до запятой (например "ПЕТРОПАВЛОВСК, Астана 40",
    // где "Астана" — название улицы, а не города; ведущий сегмент важнее).
    const firstComma = address.indexOf(',')
    if (firstComma !== -1) {
        const candidate = address.slice(0, firstComma).trim().toLowerCase()
        const canon = CITY_NAME_TO_CANONICAL.get(candidate) || CITY_NAME_TO_CANONICAL.get(stripKzLetters(candidate))
        if (canon) return { city: canon, address }
    }

    // --- Приоритет 2: район (таблица 2), маркер до или после названия ---
    const hasAktobeContext = /актобе|актюбинск/iu.test(lowerNorm)
    const resolveDistrictWord = (word: string): string | null => {
        if (AKTOBE_DISTRICTS.has(word) && hasAktobeContext) return 'Актобе'
        if (word === 'астана') return null // без контекста Актобе — не район ни одного известного города
        return DISTRICT_TO_CITY[word] || null
    }

    const districtMarkers = ['р-н', 'р-он', 'район']
    for (const marker of districtMarkers) {
        // маркер ПЕРЕД названием: "р-н Есиль"
        const reBefore = new RegExp(`${marker}\\.?\\s+([${KZ_CLASS}-]+)`, 'iu')
        const mb = lowerNorm.match(reBefore) || lower.match(reBefore)
        if (mb) {
            const word = stripKzLetters(mb[1].toLowerCase())
            const city = resolveDistrictWord(word)
            if (city) return { city, address }
        }
    }
    // маркер ПОСЛЕ названия: "Целиноградский район", "Сарыкольский р-н"
    const reAfter = new RegExp(`([${KZ_CLASS}-]+)\\s+(р-н|р-он|район)(?![${KZ_CLASS}])`, 'giu')
    let am: RegExpExecArray | null
    while ((am = reAfter.exec(lower)) !== null) {
        const word = stripKzLetters(am[1].toLowerCase())
        const city = resolveDistrictWord(word)
        if (city) return { city, address }
    }

    // --- Приоритет 3: спутник (таблица 1) / синоним головного города ---
    // Если совпадению непосредственно предшествует маркер района — это
    // указание на район (не разрешившийся выше), а не на населённый пункт
    // или головной город; пропускаем, а не угадываем.
    for (const [syn, city] of Object.entries(CITY_SYNONYMS)) {
        if (findByWordBoundary(lowerNorm, syn)) return { city, address }
    }
    for (const [city, towns] of Object.entries(CITY_CLUSTERS)) {
        const selfRe = new RegExp(`(^|[^${KZ_CLASS}])${stripKzLetters(city.toLowerCase())}(?![${KZ_CLASS}])`, 'iu')
        const selfMatch = lowerNorm.match(selfRe)
        if (selfMatch && selfMatch.index != null && !precededByDistrictMarker(lowerNorm, selfMatch.index)) {
            return { city, address }
        }
        for (const town of towns) {
            if (findByWordBoundary(lowerNorm, stripKzLetters(town.toLowerCase()))) {
                return { city, address }
            }
        }
    }

    // --- Приоритет 4 (последний): область (таблица 3) ---
    m = lowerNorm.match(/([а-яa-z-]+)ская\s+область|область\s+([а-яa-z-]+)ская|обл\.\s*([а-яa-z-]+)ская|([а-яa-z-]+)ская\s+обл\./iu)
    if (m) {
        const raw = (m[1] || m[2] || m[3] || m[4] || '') + 'ская'
        for (const [oblast, center] of Object.entries(OBLAST_TO_CENTER)) {
            if (raw.startsWith(oblast.slice(0, 6))) return { city: center, address }
        }
    }

    return { city: '', address }
}
