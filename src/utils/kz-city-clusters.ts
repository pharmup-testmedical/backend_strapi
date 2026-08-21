// Крупные города Казахстана и мелкие населённые пункты, которые в выгрузке
// в Google Таблицу должны учитываться как соответствующий крупный город
// (заданы пользователем вручную под задачу аналитики по регионам).
const CITY_CLUSTERS: Record<string, string[]> = {
    'Кокшетау': ['Атбасар', 'Есиль', 'Макинск', 'Степняк', 'Щучинск'],
    'Актау': ['Жанаозен', 'Форт-Шевченко'],
    'Актобе': ['Алга', 'Жем', 'Кандыагаш', 'Темир', 'Хромтау', 'Шалкар', 'Эмба', 'Кандагаш'],
    'Алматы': ['Алатау', 'Есик', 'Жаркент', 'Каскелен', 'Конаев', 'Сарканд', 'Талгар', 'Талдыкорган', 'Текели', 'Ушарал', 'Уштобе', 'Чунжа', 'Чилик', 'Узынагаш'],
    'Астана': ['Косшы', 'Нур-Султан', 'Сепногорск', 'Акколь', 'Шортанды', 'Караоткель'],
    'Атырау': ['Кулсары'],
    'Караганда': ['Караганды', 'Балхаш', 'Байконыр', 'Жезказган', 'Каражал', 'Каркаралинск', 'Приозёрск', 'Сарань', 'Сатпаев', 'Темиртау', 'Шахтинск'],
    'Костанай': ['Аркалык', 'Аулиеколь', 'Житикара', 'Затобольск', 'Лисаковск', 'Рудный', 'Тобыл'],
    'Павлодар': ['Аксу', 'Экибастуз'],
    'Петропавловск': ['Булаево', 'Мамлютка', 'Сергеевка', 'Тайынша'],
    'Семей': ['Абай', 'Аягоз', 'Курчатов', 'Серебрянск', 'Шемонаиха'],
    'Тараз': ['Жанатас', 'Каратау', 'Шу'],
    'Уральск': ['Аксай'],
    'Усть-Каменогорск': ['Алтай', 'Зайсан', 'Риддер', 'Шар', 'Оскемен'],
    'Шымкент': ['Арал', 'Арыс', 'Жетысай', 'Казалинск', 'Кентау', 'Кызылорда', 'Ленгер', 'Сарыагаш', 'Туркестан', 'Шардара', 'Кордай'],
}

// town/settlement name (lowercase) -> canonical major city name
const TOWN_TO_MAJOR_CITY = new Map<string, string>()
for (const [majorCity, towns] of Object.entries(CITY_CLUSTERS)) {
    TOWN_TO_MAJOR_CITY.set(majorCity.toLowerCase(), majorCity)
    for (const town of towns) {
        TOWN_TO_MAJOR_CITY.set(town.toLowerCase(), majorCity)
    }
}

// Извлекает название населённого пункта из начала строки адреса (после
// "г./с./п./а." либо просто как первое слово перед запятой) и определяет,
// к какому крупному городу он относится. Остаток строки после названия
// населённого пункта возвращается как "Адрес".
export const deriveCityAndAddress = (
    rawAddress: string | null | undefined
): { city: string; address: string } => {
    const address = (rawAddress || '').trim()
    if (!address) return { city: '', address: '' }

    // "г. Астана, ..." / "г.Семей, ..." / "с.Караоткель, ..." — тип
    // населённого пункта, затем название до первой запятой.
    const prefixMatch = address.match(/^([гспа])\.\s*([^,]+),?\s*(.*)$/iu)
    let candidateName: string | null = null
    let remainder = address

    if (prefixMatch) {
        candidateName = prefixMatch[2].trim()
        remainder = prefixMatch[3].trim()
    } else {
        // Без префикса типа населённого пункта (например oofd отдаёт
        // "г. Алматы, ..." обычно с префиксом, но на случай отсутствия —
        // берём первый сегмент до запятой как кандидата.
        const firstComma = address.indexOf(',')
        if (firstComma !== -1) {
            candidateName = address.slice(0, firstComma).trim()
            remainder = address.slice(firstComma + 1).trim()
        }
    }

    if (candidateName) {
        const majorCity = TOWN_TO_MAJOR_CITY.get(candidateName.toLowerCase())
        if (majorCity) {
            return { city: majorCity, address: remainder }
        }
    }

    // Название в начале строки не распознано — ищем любое известное
    // название населённого пункта где-либо в адресе целиком (например,
    // область/район не содержат его в начале).
    const lowerAddress = address.toLowerCase()
    for (const [town, majorCity] of TOWN_TO_MAJOR_CITY) {
        const re = new RegExp(`(^|[^а-яёa-z])${town}([^а-яёa-z]|$)`, 'iu')
        if (re.test(lowerAddress)) {
            return { city: majorCity, address }
        }
    }

    return { city: '', address }
}
