import { domainOf, friendlyName } from '@/ha/derive'
import type { Entities, HaArea, HaRegistry, HassEntity } from '@/ha/types'
import { lower, tc } from '@/i18n'
import { TV_BACKLIGHT, withBinding } from './bindings'
import { CATALOG, CONSOLE_LEN, STRIP_SIZES, stripWidth } from './catalog'
import { APERTURE_INSET, isAperture, WALL_IN } from './geometry'
import { connectRooms, foldName, keywords as kw, ROOM_WORDS } from './doors'
import { blocksDoor, CEILING, checkItem, surfaceAt } from './rules'
import { uid } from './ids'
import type { FloorMaterial, Item, ItemKind, Layout, Room } from './types'

/*
 * "Build from Home Assistant": rooms from areas, items from entities.
 * The goal is not a perfect plan but a reasonable start that the user fixes within minutes in the 3D edit mode.
 * The rules are in CLAUDE.md, section "Automatic plan (generate.ts)".
 */

type RoomType = 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'entrance' | 'office' | 'other' | 'garage' | 'garden' | 'balcony' | 'terrace'

/* ---------- keywords ---------- */

/*
 * Rooms and devices are recognized from their names (folded to lower case with foldName). The keywords are data, not UI
 * text: Turkish and English first, then common words in de, es, fr, it, nl, pl, pt, ru, ja, ko, zh, hi. The first matching
 * test wins, so mind the order in roomType and kindFor when adding a word.
 */

/** Joins keyword patterns into one regex */
const any = (...r: RegExp[]) => kw(new RegExp(r.map((x) => x.source).join('|')))

const GARAGE = kw(/garaj|garage|garaje|cochera|autorimessa|garaż|garaz|гараж|ガレージ|車庫|차고|车库|गैराज/)
const PARKING = kw(/otopark|carport|parking|aparcamiento|estacionamiento|parcheggio|parkeerplaats|стоянка|駐車場|주차장|停车场|पार्किंग/)
const BALCONY = kw(/balkon|balcony|balc[oó]n|varanda|балкон|バルコニー|ベランダ|발코니|베란다|阳台|बालकनी/)
const TERRACE = kw(/teras|terrace|terras|terraz|terraç|taras|veranda|patio|терраса|веранда|テラス|테라스|露台|天台|टैरेस/)
const GARDEN = kw(/bahçe|bahce|garden|yard|avlu|garten|jard[ií]n|jardim|giardino|tuin|ogród|ogrod|сад|двор|庭|정원|마당|花园|院子|बगीचा|बाग/)
const LAWN = kw(/çim|cim|lawn|rasen|c[eé]sped|pelouse|gazon|trawnik|relvado|gramado|газон|芝生|잔디|草坪|लॉन/)

const TV = kw(/\btv\b|televizyon|televis|télévis|telewizor|fernseher|телевизор|テレビ|티비|텔레비전|电视|टीवी/)
const CONSOLE = kw(/playstation|ps5|xbox|konsol|consol|nintendo|консоль|ゲーム機|게임기|콘솔|游戏机|कंसोल/)
const MONITOR = kw(/monitör|monitor|bildschirm|монитор|モニター|모니터|显示器|मॉनिटर/)
const CAMERA = kw(/kamera|camera|cámara|camara|caméra|câmera|камера|カメラ|카메라|摄像头|摄像机|监控|कैमरा/)
const DESK = kw(/masa|desk|schreibtisch|escritorio|bureau|scrivania|biurk|mesa|デスク|책상|书桌|डेस्क|मेज़/)
const BABY = kw(/bebek|baby|bebé|bebe|bébé|neonat|niemowl|детск|ベビー|아기|베이비|婴儿|宝宝|बेबी/)
const PROJECTOR = kw(/projeksiyon|projector|projektor|beamer|proyector|projecteur|proiettore|projetor|проектор|プロジェクター|프로젝터|投影仪|प्रोजेक्टर/)
const SCREEN = kw(/projection|screen|leinwand|pantalla|écran|ecran|schermo|scherm|ekran|экран|スクリーン|스크린|幕布|स्क्रीन/)
const SPEAKER = kw(/hoparlör|hoparlor|speaker|lautsprecher|altavoz|bocina|enceinte|haut-parleur|altoparlante|luidspreker|głośnik|glosnik|alto-falante|колонк|динамик|スピーカー|스피커|音箱|扬声器|स्पीकर/)
const COMPUTER =
  kw(/bilgisayar|comput|\bpc\b|imac|mac mini|macbook|laptop|notebook|rechner|ordenador|ordinateur|komputer|компьютер|ноутбук|パソコン|コンピュータ|컴퓨터|노트북|电脑|计算机|笔记本|कंप्यूटर|लैपटॉप/)
const LAPTOP = kw(/macbook|laptop|dizüstü|dizustu|notebook|portátil|portatil|portable|ноутбук|ノートパソコン|ノートpc|노트북|笔记本|लैपटॉप/)

const DIFFUSER = kw(/difüzör|difuzor|diffuser|diffusor|diffuseur|diffusore|difusor|dyfuzor|диффузор|ディフューザー|디퓨저|香薰|扩香/)
const LED_STRIP = kw(/led|strip|şerit|streifen|ruban|striscia|taśma|лента|テープライト|스트립|灯带/)
const WALL = kw(/wall|duvar|wand|pared|mural|parete|muur|ścienn|scienn|настенн|壁|벽|दीवार/)
const WALL_LIGHT = kw(/aplik|applique|aplique|wandleuchte|wandlampe|wandlamp|kinkiet|arandela|настенный светильник|ブラケットライト|벽등|壁灯/)
const MIRROR = kw(/ayna|mirror|spiegel|espejo|miroir|specchio|lustro|espelho|зеркал|ミラー|鏡|거울|镜|दर्पण|आईना/)
const DESK_LAMP =
  kw(/masa lamba|desk lamp|schreibtischlampe|schreibtischleuchte|lámpara de escritorio|lampara de escritorio|lampe de bureau|lampada da scrivania|bureaulamp|lampka biurkowa|luminária de mesa|настольная лампа|デスクライト|台灯|डेस्क लैंप/)
const FLOOR_LAMP =
  kw(/lambader|floor lamp|stehlampe|stehleuchte|lámpara de pie|lampara de pie|lampadaire|piantana|lampada da terra|vloerlamp|staande lamp|lampa podłogowa|luminária de chão|candeeiro de pé|торшер|フロアランプ|플로어 ?램프|장스탠드|落地灯|फ्लोर लैंप/)
const FIREPLACE = kw(/şömine|somine|fireplace|kamin|chimenea|cheminée|cheminee|caminetto|haard|kominek|lareira|камин|暖炉|벽난로|壁炉|अंगीठी/)
const POOL = kw(/havuz|pool|piscin|zwembad|basen|бассейн|プール|수영장|泳池|स्विमिंग पूल/)
const STREET_LAMP =
  kw(/sokak|street|cadde|yol lamba|straßenlaterne|strassenlaterne|straßenlampe|farola|réverbère|reverbere|lampione|straatlantaarn|lantaarnpaal|latarnia uliczna|poste de luz|candeeiro de rua|уличный фонарь|街灯|가로등|路灯|स्ट्रीट लाइट/)
const STRING_LIGHTS =
  kw(/ip ışık|ip isik|string|girland|guirlande|guirnalda|ghirlanda|fener|lantern|laterne|farolillo|lichterkette|lichtsnoer|lampion|lampki|gambiarra|гирлянд|фонар|ストリングライト|ランタン|줄조명|랜턴|串灯|灯串|灯笼|झालर|लालटेन/)
const OUTDOOR =
  kw(/bahçe|bahce|garden|dış aydınlatma|dis aydinlatma|outdoor|veranda|teras|balkon|avlu|garten|außen|aussen|jard[ií]n|jardim|exterior|extérieur|exterieur|giardino|esterno|tuin|buiten|ogród|ogrod|zewnętrz|zewnetrz|сад|наружн|уличн|庭|屋外|정원|야외|花园|户外|बगीचा|terras|terraz|balc[oó]n/)
const CEILING_LIGHT = kw(/plafon|ceiling light|deckenleuchte|deckenlampe|plafón|plafom|потолочн|シーリングライト|천장등|吸顶灯|छत की लाइट/)
const TRACK_LIGHT = kw(/\bray\b|track|schiene|carril|binario|szynow|trilho|трек|ダクトレール|레일|轨道灯|ट्रैक/)
const TABLE_LAMP =
  kw(/abajur|table lamp|komodin|tischlampe|tischleuchte|nachttisch|mesita|velador|chevet|lampe de table|abat-jour|abatjour|comodino|tafellamp|nachtkast|lampka nocna|ночник|テーブルランプ|무드등|床头灯|टेबल लैंप/)
const CHANDELIER =
  kw(/avize|tavan|ceiling|chandelier|kronleuchter|deckenl|lámpara de techo|de techo|de teto|lustre|plafonnier|plafond|lampadario|soffitto|kroonluchter|hanglamp|żyrandol|zyrandol|sufit|люстр|потол|シャンデリア|天井|샹들리에|천장|吊灯|吸顶灯|天花板|झूमर/)
const CEILING_WORDS = kw(/tavan|ceiling|decke|techo|teto|plafond|soffitto|sufit|потол|天井|천장|吊扇|吸顶|छत/)
const FAN = kw(/vantilatör|vantilator|\bfan\b|ventilat|ventilad|wentylat|вентилятор|扇風機|선풍기|风扇|电扇|पंखा/)
const LAMP = kw(/lamba|ışık|isik|light|lamp|licht|leuchte|\bluz\b|lámpara|lumière|lumiere|\bluce\b|światło|swiatlo|свет|ламп|ライト|照明|조명|전등|램프|灯|लाइट|बत्ती/)
const BED_HEADBOARD =
  kw(/yatak başlığı|yatak basligi|başlık ışığı|headboard|kopfteil|bettkopf|cabecero|tête de lit|tete de lit|testiera|hoofdbord|zagłówek|zaglowek|cabeceira|изголовь|ヘッドボード|헤드보드|हेडबोर्ड/)
const BEDSIDE = kw(/başucu|basucu|床头/)

/** Ceiling fan (its switch, its light): names with ceiling plus fan */
const CEILING_FAN =
  kw(/(tavan|ceiling)[ _-]?(vantilat|fan)|deckenventilator|plafondventilator|ventila(?:dor|teur|tore) d[ea] (?:techo|teto|plafond|soffitto)|wentylator sufitowy|потолочный вентилятор|シーリングファン|실링팬|吊扇|छत का पंखा/)

/** Indoor pan-tilt camera standing on a desk or shelf (like a Tapo C200): names with desk, baby, 360, PTZ */
const DESK_CAM = any(DESK, BABY, /360|ptz|pan.?tilt|\bc[12]\d\d\b/)

const VACUUM = kw(/süpürge|supurge|vacuum|stick|staubsauger|aspiradora|aspirador|aspirateur|aspirapolvere|stofzuiger|odkurzacz|пылесос|掃除機|청소기|吸尘器|वैक्यूम/)
const ROBOT = kw(/robot|робот|ロボット|로봇|机器人|扫地|रोबोट/)
const STICK_VACUUM =
  kw(/dikey|stick|dyson|kablosuz|şarjlı|sarjli|vertical|akku|kabellos|escoba|inalámbric|inalambric|sin cable|balai|sans fil|scopa|senza fili|steelstofzuiger|snoerloos|pionow|bezprzewod|sem fio|вертикальн|беспроводн|スティック|コードレス|무선|스틱|无线|手持|कॉर्डलेस/)
const WATER_HEATER =
  kw(/şofben|sofben|termosifon|water heater|geyser|warmwasser|durchlauferhitzer|calentador|chauffe.?eau|ballon d'eau chaude|scaldabagno|scaldacqua|bojler|podgrzewacz|esquentador|termoacumulador|aquecedor de água|водонагреватель|бойлер|給湯器|温水器|온수기|热水器|गीज़र|गीजर|वॉटर हीटर/)
const HOT_TUB = kw(/jakuzi|jacuzzi|hot ?tub|\bspa\b|джакузи|ジャグジー|자쿠지|按摩浴缸|जकूज़ी/)
const FOUNTAIN = kw(/süs havuzu|sus havuzu|çeşme|cesme|fountain|fontan|fontaine|fontein|fuente|springbrunnen|chafariz|фонтан|噴水|분수|喷泉|फव्वारा/)
const OUTDOOR_SHOWER =
  kw(/bahçe duş|bahce dus|dış duş|dis dus|outdoor shower|gartendusche|außendusche|aussendusche|ducha exterior|ducha de jard|douche extérieure|douche exterieure|douche de jardin|doccia esterna|doccia da giardino|buitendouche|tuindouche|prysznic ogrodowy|chuveiro exterior|уличный душ|летний душ|屋外シャワー|야외 샤워|户外淋浴|आउटडोर शावर/)
const SPRINKLER =
  kw(/sulama|irrigation|fıskiye|fiskiye|sprinkler|bewässerung|bewaesserung|sprenger|riego|aspersor|arrosage|arroseur|irriga|beregening|sproeier|nawadnian|zraszacz|\brega\b|полив|散水|スプリンクラー|스프링클러|灌溉|洒水|सिंचाई|स्प्रिंकलर/)
const GRILL = kw(/mangal|barbekü|barbeku|barbecue|barbacoa|parrilla|grill|griglia|churrasq|гриль|мангал|барбекю|バーベキュー|グリル|그릴|바베큐|烧烤|ग्रिल/)
const EV_CHARGER =
  kw(/şarj istasyon|sarj istasyon|wallbox|ev charger|araç şarj|arac sarj|zappi|easee|ladestation|ladesäule|ladesaeule|punto de recarga|cargador de coche|borne de recharge|colonnina|ricarica auto|laadpaal|laadstation|stacja ładowania|ładowarka samochod|carregador de carro|зарядная станция|электрозарядн|充電スタンド|ev充電|전기차 충전|充电桩|चार्जिंग स्टेशन/)
const BOILER = kw(/kombi|boiler|heizkessel|gastherme|\btherme\b|caldera|chaudière|chaudiere|caldaia|cv-ketel|cv ketel|kocioł|kociol|caldeira|котёл|котел|ボイラー|보일러|锅炉|壁挂炉|बॉयलर/)
const RADIATOR = kw(/radyatör|petek|radiator|heizkörper|heizkoerper|radiador|radiateur|radiatore|grzejnik|kaloryfer|радиатор|ラジエーター|라디에이터|暖气片|रेडिएटर/)
const THERMOSTAT = kw(/termostat|thermostat|термостат|サーモスタット|온도조절기|温控器|恒温器|थर्मोस्टेट/)
const TOWEL_WARMER =
  kw(/havlupan|towel|handtuch|toallero|sèche-serviette|seche-serviette|sèche serviette|scaldasalviette|handdoek|suszarka na ręczniki|toalheiro|полотенцесушител|タオル|수건|毛巾|तौलिया/)
const COFFEE = kw(/kahve|coffee|espresso|kaffee|caf[eéè]|koffie|kawa\b|ekspres|кофе|コーヒー|커피|咖啡|कॉफ़ी|कॉफी/)
const KETTLE = kw(/kettle|su ısıtıcı|su isitici|wasserkocher|hervidor|bouilloire|bollitore|waterkoker|czajnik|chaleira|чайник|ケトル|전기포트|电水壶|烧水壶|केतली/)
const MICROWAVE = kw(/mikrodalga|microwave|mikrowelle|microond|micro-ondes|micro ondes|magnetron|mikrofal|микроволнов|電子レンジ|전자레인지|微波炉|माइक्रोवेव/)
const AIR_FRYER =
  kw(/airfryer|air fryer|fritöz|fritoz|fritteuse|freidora|friteuse|friggitrice|frituurpan|frytkownica|fritadeira|фритюрниц|аэрофритюр|ノンフライヤー|에어프라이어|空气炸锅|एयर फ्रायर/)
const ROUTER = kw(/router|routeur|modem|роутер|маршрутизатор|ルーター|공유기|路由器|राउटर/)
const PRINTER = kw(/yazıcı|yazici|printer|drucker|impres|imprimante|stampante|drukarka|принтер|プリンター|프린터|打印机|प्रिंटर/)
const PET_FEEDER = kw(/mama|feeder|futterautomat|futterspender|comedero|comedouro|croquette|distributore di cibo|voerautomaat|karmnik|кормушк|кормилк|給餌|급식기|喂食器|फीडर/)
const DEHUMIDIFIER = kw(/nem alma|dehumid|deshumid|déshumid|deumid|desumid|entfeuchter|ontvochtiger|osuszacz|осушител|除湿|제습|डीह्यूमिडिफ़ायर/)
const HUMIDIFIER = kw(/nemlendirici|humidifier|humidif|umidif|befeuchter|bevochtiger|nawilżacz|nawilzacz|увлажнител|加湿|가습기|ह्यूमिडिफ़ायर/)
const PURIFIER = kw(/hava temizle|purifier|purifica|luftreiniger|luchtreiniger|oczyszczacz|очистител|空気清浄|공기청정|空气净化|प्यूरीफायर/)
const SPACE_HEATER =
  kw(/ısıtıcı|isitici|konvektör|konvektor|convector|heizlüfter|heizluefter|heizgerät|calefactor|stufa|termoventilatore|kachel|farelka|termowentylator|aquecedor|обогревател|난로|取暖器|暖风机/)
const HEATER = kw(/heater|ヒーター|히터|हीटर/)
const SIREN = kw(/siren|сирена|サイレン|사이렌|警报器|सायरन/)
const WASHER = kw(/çamaşır|camasir|washer|washing|waschmaschine|lavadora|lave-linge|lave linge|lavatrice|\bwasmachine|pralka|lavar roupa|стиральн|洗濯機|세탁기|洗衣机|वॉशिंग मशीन/)
const DRYER = kw(/kurutma|dryer|trockner|secadora|sèche-linge|seche-linge|sèche linge|asciugatrice|droger|droogtrommel|suszarka|secador|сушильн|乾燥機|건조기|烘干机|ड्रायर/)
const DISHWASHER =
  kw(/bulaşık|bulasik|dishwasher|geschirrspüler|geschirrspueler|spülmaschine|spuelmaschine|lavavajillas|lavaplatos|lave-vaisselle|lave vaisselle|lavastoviglie|vaatwas|zmywark|lava-louça|lava-loiça|máquina de lavar louça|посудомо|食洗機|食器洗|식기세척기|洗碗机|डिशवॉशर/)
const OVEN = kw(/fırın|firin|oven|backofen|horno|forno|piekarnik|духовк|オーブン|오븐|烤箱|ओवन/)
/** Numbered outlets (Outlet 1, socket_2): outlets of a smart power strip */
const OUTLET = kw(/(?:priz|outlet|socket|soket|steckdose|enchufe|prise|presa|stopcontact|gniazd[a-z]*|tomada|розетк[а-я]*|コンセント|콘센트|插座|插孔|सॉकेट)[ _-]?\d\b/)
const WATER_DISPENSER =
  kw(/sebil|water dispenser|su makinesi|su pınarı|wasserspender|dispensador de agua|distributeur d'eau|distributore d'acqua|erogatore|waterdispenser|waterkoeler|dystrybutor wody|bebedouro|кулер|ウォーターサーバー|정수기|饮水机|वाटर डिस्पेंसर/)
const AC = kw(/klima|air ?con|airco|acondicionado|condicionado|climatiz|climatis|condizionatore|кондиционер|エアコン|에어컨|空调|एयर कंडीशनर/)
const WALL_SWITCH =
  kw(/duvar anahtar|wall switch|lichtschalter|wandschalter|interruptor de pared|interruptor de parede|interrupteur mural|interruttore a muro|wandschakelaar|lichtschakelaar|włącznik światła|wlacznik swiatla|выключатель|壁スイッチ|벽 스위치|墙壁开关|दीवार स्विच/)
const VALVE = kw(/\btrv\b|vana|valve|ventil\b|v[aá]lvula|valvol|vanne|zaw[oó]r|głowica|glowica|клапан|вентиль|バルブ|밸브|阀|वाल्व/)
const WATER = kw(/su|water|wasser|agua|água|\beau\b|acqua|woda|wody|вод|水|물|पानी/)
const MAIN = kw(/ana vana|main|haupt|principal|hoofd|główny|glowny|главн|元栓|메인|总阀|मुख्य/)
const MOTORCYCLE = kw(/motosiklet|motor|scooter|vespa|\bmoto\b|motocic|motocykl|roller|skuter|мотоцикл|скутер|байк|バイク|オートバイ|오토바이|스쿠터|摩托|मोटरसाइकिल|स्कूटर/)
const SCOOTER = kw(/scooter|vespa|roller|skuter|скутер|スクーター|스쿠터|踏板|स्कूटर/)
const CAR =
  kw(/araba|araç|arac|\bcar\b|\bauto\b|coche|carro|voiture|samoch[oó]d|машина|автомобил|クルマ|自動車|자동차|汽车|爱车|गाड़ी|tesla|bmw|audi|mercedes|toyota|renault|fiat|volkswagen|\bvw\b|togg|hyundai|\bkia\b|ford|peugeot|skoda|honda|volvo|polestar|byd/)
const DOORBELL = kw(/kapı zili|kapi zili|doorbell|\bzil\b|türklingel|klingel|timbre|sonnette|campanello|deurbel|dzwonek|campainha|звонок|ドアホン|インターホン|呼び鈴|초인종|도어벨|门铃|डोरबेल/)
const GATE =
  kw(/bahçe kapı|bahce kapi|\bgate\b|kapı motoru|kapi motoru|\btor\b|gartentor|einfahrtstor|hoftor|port[oó]n|cancela|portail|cancello|\bpoort\b|brama|portão|portao|ворота|ゲート|門扉|대문|게이트|大门|गेट|फाटक/)
const AWNING = kw(/tente|awning|markise|markies|markiz|toldo|banne|tenda da sole|zonnescherm|маркиз|オーニング|어닝|遮阳篷|शामियाना/)
const WINDOW = kw(/pencere|window|fenster|ventana|fenêtre|fenetre|finestra|\braam\b|okno|janela|окно|窓|창문|窗|खिड़की/)
const MAILBOX = kw(/posta|mailbox|mail|briefkasten|buz[oó]n|boîte aux lettres|boite aux lettres|brievenbus|skrzynka|correio|correo|почтов|郵便|ポスト|우편함|信箱|邮箱|डाक/)
const SOLAR =
  kw(/güneş|gunes|solar|\bpv\b|inverter|invertör|invertor|photovolta|fotovolta|fotowolta|solaire|zonne|słoneczn|sloneczn|wechselrichter|omvormer|солнечн|инвертор|太陽光|ソーラー|パワコン|태양광|인버터|光伏|太阳能|逆变器|सौर|सोलर|इन्वर्टर/)

const ROOM_TESTS: [RoomType, RegExp][] = [
  // Outdoor spaces and garage, from the name; areas like "Garden lights" count as the garden too
  ['garage', any(GARAGE, PARKING)],
  ['balcony', BALCONY],
  ['terrace', TERRACE],
  ['garden', GARDEN],
  ['living', any(ROOM_WORDS.living, /sofa/)],
  ['kitchen', any(ROOM_WORDS.kitchen, /stove/)],
  ['bedroom', ROOM_WORDS.bedroom],
  ['bathroom', any(ROOM_WORDS.bathroom, /shower/)],
  ['entrance', any(ROOM_WORDS.entrance, /door/)],
  ['office', any(ROOM_WORDS.office, /laptop|desk/)],
]

function roomType(area: HaArea): RoomType {
  const s = foldName(`${area.name} ${area.area_id} ${area.icon ?? ''}`)
  return ROOM_TESTS.find(([, re]) => re.test(s))?.[0] ?? 'other'
}

const SIZE: Record<RoomType, [number, number]> = {
  living: [6.4, 5.2],
  kitchen: [4.4, 4.2],
  bedroom: [4.6, 4.2],
  bathroom: [2.8, 2.6],
  entrance: [3, 2.6],
  office: [3.6, 3.4],
  other: [3.6, 3.4],
  garage: [3.6, 6],
  garden: [8, 6],
  balcony: [3.6, 1.6],
  terrace: [5, 4],
}
const FLOOR: Record<RoomType, FloorMaterial> = {
  living: 'wood',
  kitchen: 'tile',
  bedroom: 'carpet',
  bathroom: 'tile',
  entrance: 'concrete',
  office: 'wood',
  other: 'wood',
  garage: 'concrete',
  garden: 'grass',
  balcony: 'deck',
  terrace: 'paving',
}
const ORDER: RoomType[] = ['living', 'kitchen', 'office', 'other', 'bedroom', 'bathroom', 'entrance', 'garage', 'balcony', 'terrace', 'garden']
/** Room type of the plan (model/types.ts > RoomType): outdoor spaces and garage */
const ROOM_KIND: Partial<Record<RoomType, NonNullable<Room['type']>>> = { garage: 'garage', garden: 'garden', balcony: 'balcony', terrace: 'terrace' }

export { uid }

/* ---------- placement helpers ---------- */

type Side = 'back' | 'front' | 'left' | 'right'
const ROT: Record<Side, number> = { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }

/** Position at u (0-1) along the wall, with the item's back against the wall. */
function onWall(room: Room, side: Side, u: number, kind: ItemKind) {
  const depth = CATALOG[kind].size[1]
  // Doors and windows relative to the room boundary; everything else against the wall's inner face (the wall is centered
  // on the boundary, the inner face is WALL_IN inside).
  const inset = isAperture(kind) ? APERTURE_INSET : WALL_IN + depth / 2 + 0.02
  switch (side) {
    case 'back':
      return { x: room.x + u * room.w, z: room.z + inset, rot: ROT.back }
    case 'front':
      return { x: room.x + u * room.w, z: room.z + room.d - inset, rot: ROT.front }
    case 'left':
      return { x: room.x + inset, z: room.z + u * room.d, rot: ROT.left }
    case 'right':
      return { x: room.x + room.w - inset, z: room.z + u * room.d, rot: ROT.right }
  }
}

function at(room: Room, u: number, v: number, rot = 0) {
  return { x: room.x + u * room.w, z: room.z + v * room.d, rot }
}

const radius = (k: ItemKind) => Math.max(...CATALOG[k].size) / 2

function free(items: Item[], x: number, z: number, kind: ItemKind, rot = 0) {
  return items.every((it) => Math.hypot(it.x - x, it.z - z) > (radius(it.kind) + radius(kind)) * 0.8) && !blocksDoor(items, { kind, x, z, rot })
}

function inRoom(room: Room, x: number, z: number) {
  return x >= room.x && x <= room.x + room.w && z >= room.z && z <= room.z + room.d
}

/** Finds a free spot for a wall item: the preferred walls in order, every 0.7 m. */
function wallSlot(room: Room, items: Item[], kind: ItemKind, sides: Side[]) {
  for (const side of sides) {
    const len = side === 'back' || side === 'front' ? room.w : room.d
    const n = Math.max(1, Math.floor((len - 0.8) / 0.7))
    for (let i = 0; i <= n; i++) {
      const u = (0.4 + (i * (len - 0.8)) / n) / len
      const p = onWall(room, side, u, kind)
      if (free(items, p.x, p.z, kind, p.rot)) return p
    }
  }
  return onWall(room, sides[0], 0.5, kind)
}

/** Free spot near the corners for a floor item. */
function floorSlot(room: Room, items: Item[], kind: ItemKind) {
  const m = 0.5
  const pts = [
    [room.x + room.w - m, room.z + m],
    [room.x + m, room.z + m],
    [room.x + room.w - m, room.z + room.d - m],
    [room.x + m, room.z + room.d - m],
    [room.x + room.w / 2, room.z + room.d - m],
    [room.x + room.w - m, room.z + room.d / 2],
  ]
  for (const [x, z] of pts) if (free(items, x, z, kind)) return { x, z, rot: 0 }
  return { x: room.x + room.w / 2, z: room.z + room.d / 2, rot: 0 }
}

/* ---------- room templates (unbound items; entities are bound to them later) ---------- */

/** The room the template is built in and all rooms: used when shifting an item that blocks a door. */
let ctx: { room: Room; rooms: Room[] } | null = null
const SHIFTS = [0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.5, -1.5]

/**
 * Adds a template item. Doors are placed before furniture; an item in front of a door is shifted along its own axis
 * (along the wall for wall items), and skipped when there is no room.
 */
function add(items: Item[], kind: ItemKind, p: { x: number; z: number; rot: number }, y?: number) {
  const it: Item = { id: uid('it'), kind, x: p.x, z: p.z, rot: p.rot, y }
  if (!blocksDoor(items, it)) {
    items.push(it)
    return it
  }
  if (ctx) {
    const level = { id: 'gen', name: '', rooms: ctx.rooms, items }
    for (const d of SHIFTS) {
      const cand = { ...it, x: p.x + d * Math.cos(p.rot), z: p.z - d * Math.sin(p.rot) }
      if (!inRoom(ctx.room, cand.x, cand.z) || blocksDoor(items, cand)) continue
      if (checkItem(level, cand).ok) {
        items.push(cand)
        return cand
      }
    }
  }
  return it
}

/** Lines items up side by side along a wall. */
function rowAlong(room: Room, items: Item[], side: Side, kinds: ItemKind[], start = 0.15) {
  const len = side === 'back' || side === 'front' ? room.w : room.d
  let cursor = start
  for (const k of kinds) {
    const w = CATALOG[k].size[0]
    if (cursor + w > len - 0.1) break
    add(items, k, onWall(room, side, (cursor + w / 2) / len, k))
    cursor += w + 0.02
  }
}

function template(type: RoomType, room: Room, items: Item[]) {
  ctx = { room, rooms: ctx?.rooms ?? [room] }
  switch (type) {
    case 'living': {
      add(items, 'rug', at(room, 0.5, 0.55))
      // TV unit against the wall, TV standing on it; the unit is 2.2 m so a console fits next to the TV
      const unit = add(items, 'tvUnit', onWall(room, 'back', 0.5, 'tvUnit'))
      if (unit) unit.len = 2.2
      const tvAt = onWall(room, 'back', 0.5, 'tv')
      const tv = add(items, 'tv', unit ? { ...tvAt, x: unit.x } : tvAt, unit ? 0.5 : undefined)
      if (tv) tv.variant = unit ? 'stand' : 'wall'
      add(items, 'sofa', at(room, 0.5, 0.76, Math.PI))
      add(items, 'coffeeTable', at(room, 0.5, 0.5))
      add(items, 'armchair', at(room, 0.17, 0.48, Math.PI / 2))
      add(items, 'bookshelf', onWall(room, 'left', 0.2, 'bookshelf'))
      add(items, 'plant', at(room, 0.92, 0.12))
      break
    }
    case 'kitchen': {
      rowAlong(room, items, 'back', ['fridge', 'sink', 'kitchenCounter', 'stove'])
      const counter = items.find((i) => i.kind === 'kitchenCounter' && inRoom(room, i.x, i.z))
      if (counter) add(items, 'ledStrip', { x: counter.x, z: room.z + WALL_IN + 0.05, rot: 0 }, 1.45)
      add(items, 'diningTable', at(room, 0.5, 0.66))
      add(items, 'chair', at(room, 0.5, 0.86, Math.PI))
      add(items, 'chair', at(room, 0.5, 0.46, 0))
      break
    }
    case 'bedroom': {
      const bed = add(items, 'bed', { x: room.x + room.w / 2, z: room.z + WALL_IN + 1.05 + 0.02, rot: 0 })
      add(items, 'nightstand', { x: bed.x - 1.15, z: room.z + WALL_IN + 0.25, rot: 0 })
      add(items, 'nightstand', { x: bed.x + 1.15, z: room.z + WALL_IN + 0.25, rot: 0 })
      add(items, 'wardrobe', onWall(room, 'left', 0.62, 'wardrobe'))
      add(items, 'plant', at(room, 0.9, 0.86))
      break
    }
    case 'bathroom': {
      rowAlong(room, items, 'back', ['bathtub', 'toilet'], 0.12)
      const basin = add(items, 'washbasin', onWall(room, 'right', 0.62, 'washbasin'))
      add(items, 'mirrorLight', { x: room.x + room.w - WALL_IN - 0.04, z: basin.z, rot: -Math.PI / 2 })
      break
    }
    case 'entrance': {
      add(items, 'door', onWall(room, 'front', 0.5, 'door'))
      add(items, 'shoeCabinet', onWall(room, 'left', 0.45, 'shoeCabinet'))
      break
    }
    case 'office': {
      const desk = add(items, 'desk', onWall(room, 'back', 0.5, 'desk'))
      add(items, 'chair', { x: desk.x, z: desk.z + 0.75, rot: Math.PI })
      add(items, 'monitor', { x: desk.x - 0.15, z: desk.z - 0.1, rot: 0 }, 0.75)
      add(items, 'deskLamp', { x: desk.x + 0.52, z: desk.z - 0.05, rot: 0 }, 0.75)
      add(items, 'bookshelf', onWall(room, 'right', 0.5, 'bookshelf'))
      add(items, 'plant', at(room, 0.12, 0.88))
      break
    }
    default:
      break
  }
}

/* ---------- entity → item kind ---------- */

/**
 * Suggested item kind for an entity; null if it does not belong in the plan. model: manufacturer and model from the
 * device registry (HaRegistry.entityModel). A HomePod named after its room ("Living Room") is only recognized by its model.
 */
export function kindFor(e: HassEntity, model = ''): ItemKind | null {
  const d = domainOf(e.entity_id)
  const n = foldName(`${friendlyName(e)} ${e.entity_id}`)
  const dc = String(e.attributes.device_class ?? '')
  switch (d) {
    case 'light':
      if (/segment/.test(n)) return null
      if (DIFFUSER.test(n)) return 'diffuser'
      if (CEILING_FAN.test(n)) return 'ceilingFan'
      if (any(LED_STRIP, /backlight/).test(n)) return 'ledStrip'
      if (any(WALL_LIGHT, WALL).test(n)) return 'wallLight'
      if (MIRROR.test(n)) return 'mirrorLight'
      if (any(DESK, /настольн|台灯/).test(n)) return 'deskLamp'
      if (any(FLOOR_LAMP, /floor/).test(n)) return 'floorLamp'
      if (FIREPLACE.test(n)) return 'fireplace'
      if (POOL.test(n)) return 'pool'
      // Front of the house and street: street lamp
      if (STREET_LAMP.test(n)) return 'streetLamp'
      if (STRING_LIGHTS.test(n)) return 'stringLights'
      if (OUTDOOR.test(n)) return 'gardenLight'
      if (CEILING_LIGHT.test(n)) return 'ceilingLight'
      if (TRACK_LIGHT.test(n)) return 'trackLight'
      if (TABLE_LAMP.test(n)) return 'tableLamp'
      return 'pendant'
    case 'switch':
      if (/adguard|alarm|permit|dreamview|music mode|zigbee|bridge|güncelle|update|sonoff_10023/.test(n)) return null
      if (any(TV, /tcl|samsung tv/).test(n)) return 'tv'
      if (CONSOLE.test(n)) return 'console'
      if (MONITOR.test(n)) return 'monitor'
      if (CAMERA.test(n)) return DESK_CAM.test(n) ? 'deskCamera' : 'camera'
      // Charging plug of a stick vacuum ("Dyson vacuum"), not of a robot vacuum
      if (VACUUM.test(n) && !ROBOT.test(n)) return 'stickVacuum'
      if (WATER_HEATER.test(n)) return 'waterHeater'
      if (POOL.test(n)) return 'pool'
      if (HOT_TUB.test(n)) return 'hotTub'
      if (FOUNTAIN.test(n)) return 'fountain'
      if (OUTDOOR_SHOWER.test(n)) return 'outdoorShower'
      if (SPRINKLER.test(n)) return 'sprinkler'
      if (GRILL.test(n)) return 'grill'
      if (EV_CHARGER.test(n)) return 'evCharger'
      if (GARAGE.test(n)) return 'garageDoor'
      // The boiler hangs on the wall with its own model; radiators are grouped with it
      if (BOILER.test(n)) return 'boiler'
      // Towel warmer before radiator: a "towel radiator" is a towel warmer
      if (TOWEL_WARMER.test(n)) return 'towelWarmer'
      if (any(/kuru kontak/, RADIATOR).test(n)) return 'radiator'
      if (FIREPLACE.test(n)) return 'fireplace'
      if (COFFEE.test(n)) return 'coffeeMachine'
      if (KETTLE.test(n)) return 'kettle'
      if (MICROWAVE.test(n)) return 'microwave'
      if (AIR_FRYER.test(n)) return 'airFryer'
      if (PROJECTOR.test(n)) return 'projector'
      if (ROUTER.test(n)) return 'router'
      if (/\bnas\b|synology|qnap/.test(n)) return 'nas'
      if (PRINTER.test(n)) return 'printer'
      if (PET_FEEDER.test(n)) return 'petFeeder'
      if (DEHUMIDIFIER.test(n)) return 'dehumidifier'
      if (PURIFIER.test(n)) return 'airPurifier'
      if (any(SPACE_HEATER, HEATER).test(n)) return 'heater'
      if (SIREN.test(n)) return 'siren'
      if (COMPUTER.test(n)) return 'computer'
      if (SPEAKER.test(n)) return 'speaker'
      // Before the washer: "dishwasher" contains "washer"
      if (DISHWASHER.test(n)) return 'dishwasher'
      if (WASHER.test(n)) return 'washer'
      if (DRYER.test(n)) return 'dryer'
      if (OVEN.test(n)) return 'oven'
      // Numbered outlets (Outlet 1, outlet_2): outlets of a smart power strip, gathered into one item below
      if (OUTLET.test(n)) return 'powerStrip'
      if (WATER_DISPENSER.test(n)) return 'waterDispenser'
      if (AC.test(n)) return 'acUnit'
      if (DIFFUSER.test(n)) return 'diffuser'
      if (WALL_SWITCH.test(n)) return 'wallSwitch'
      if (any(BED_HEADBOARD, BEDSIDE).test(n)) return 'wallLight'
      if (WALL_LIGHT.test(n)) return 'wallLight'
      if (MIRROR.test(n)) return 'mirrorLight'
      if (DESK_LAMP.test(n)) return 'deskLamp'
      if (FLOOR_LAMP.test(n)) return 'floorLamp'
      if (CEILING_FAN.test(n)) return 'ceilingFan'
      if (CHANDELIER.test(n)) return 'pendant'
      if (LED_STRIP.test(n)) return 'ledStrip'
      if (FAN.test(n)) return 'fan'
      if (LAMP.test(n)) return 'floorLamp'
      return 'plug'
    case 'media_player':
      if (/homepod|home pod/.test(`${n} ${foldName(model)}`)) return 'homepod'
      if (/soundbar|sonos arc|sonos beam|playbar/.test(`${n} ${foldName(model)}`)) return 'soundbar'
      if (PROJECTOR.test(n)) return 'projector'
      if (any(/echo|alexa|google home|nest (hub|mini|audio)|sonos/, SPEAKER).test(`${n} ${foldName(model)}`)) return 'speaker'
      return CONSOLE.test(n) ? 'console' : 'tv'
    case 'climate':
      if (FIREPLACE.test(n)) return 'fireplace'
      if (any(SPACE_HEATER, /electric heater/).test(n)) return 'heater'
      if (VALVE.test(n)) return 'thermostat'
      if (BOILER.test(n)) return 'boiler'
      return any(THERMOSTAT, RADIATOR, HEATER).test(n) ? 'radiator' : 'acUnit'
    case 'water_heater':
      return BOILER.test(n) ? 'boiler' : 'waterHeater'
    case 'valve':
      if (FOUNTAIN.test(n)) return 'fountain'
      if (OUTDOOR_SHOWER.test(n)) return 'outdoorShower'
      if (any(SPRINKLER, GARDEN, LAWN).test(n)) return 'sprinkler'
      return any(WATER, MAIN).test(n) ? 'waterValve' : null
    case 'lawn_mower':
      return 'lawnMower'
    case 'device_tracker':
      // Vehicle location (Tesla, BMW... integrations); phone locations are not put in the plan
      if (MOTORCYCLE.test(n)) return 'motorcycle'
      return CAR.test(n) ? 'car' : null
    case 'siren':
      return 'siren'
    case 'humidifier':
      if (DEHUMIDIFIER.test(n)) return 'dehumidifier'
      if (HUMIDIFIER.test(n) && !any(DIFFUSER, /aroma/).test(n)) return 'humidifier'
      return 'diffuser'
    case 'fan':
      if (any(PURIFIER, /temizleyici/).test(n)) return 'airPurifier'
      return CEILING_WORDS.test(n) ? 'ceilingFan' : 'fan'
    case 'vacuum':
      return STICK_VACUUM.test(n) ? 'stickVacuum' : 'robotVacuum'
    case 'camera':
      if (DOORBELL.test(n)) return 'doorbell'
      return DESK_CAM.test(n) ? 'deskCamera' : 'camera'
    case 'alarm_control_panel':
      return 'alarmPanel'
    case 'lock':
      return 'door'
    case 'cover':
      if (any(PROJECTOR, SCREEN).test(n)) return 'projectorScreen'
      if (dc === 'garage' || GARAGE.test(n)) return 'garageDoor'
      if (dc === 'gate' || GATE.test(n)) return 'gate'
      if (dc === 'awning' || AWNING.test(n)) return 'awning'
      return /garage|door|gate/.test(dc) ? 'door' : 'window'
    case 'binary_sensor':
      if (dc === 'window') return 'window'
      if (dc === 'door' || dc === 'garage_door') return 'door'
      if (dc === 'opening') return WINDOW.test(n) ? 'window' : 'door'
      if (dc === 'motion' || dc === 'occupancy' || dc === 'presence') return 'motionSensor'
      if (dc === 'vibration') return 'vibrationSensor'
      if (dc === 'smoke' || dc === 'gas' || dc === 'carbon_monoxide') return 'smokeDetector'
      if (dc === 'moisture') return 'leakSensor'
      if (MAILBOX.test(n)) return 'mailbox'
      // Ping sensor of a computer (HA > Ping)
      if (dc === 'connectivity' && any(COMPUTER, /\bmac\b|windows/).test(n)) return 'computer'
      return null
    case 'sensor':
      if (['carbon_dioxide', 'pm25', 'aqi', 'volatile_organic_compounds'].includes(dc)) return 'airQuality'
      if ((dc === 'power' || dc === 'energy') && SOLAR.test(n)) return 'solarPanel'
      return dc === 'temperature' ? 'tempSensor' : null
    default:
      return null
  }
}

/** Model of the kind as told by the entity: HomePod mini or HomePod ("mini" in the model or the name), and so on. */
export function variantFor(kind: ItemKind, e: HassEntity, model = ''): string | undefined {
  const s = foldName(`${model} ${friendlyName(e)} ${e.entity_id}`)
  if (kind === 'homepod') return /mini/.test(s) ? 'mini' : 'full'
  if (kind === 'console') return /xbox/.test(s) ? 'xbox-v' : 'ps5-v'
  if (kind === 'computer') return /mac ?mini/.test(s) ? 'mini' : LAPTOP.test(s) ? 'laptop' : /imac/.test(s) ? 'imac' : 'tower'
  if (kind === 'smokeDetector') return e.attributes.device_class === 'gas' ? 'gas' : e.attributes.device_class === 'carbon_monoxide' ? 'co' : 'smoke'
  if (kind === 'speaker') return /nest|google/.test(s) ? 'nest' : /sonos/.test(s) ? 'sonos' : 'echo'
  if (kind === 'motorcycle') return SCOOTER.test(s) ? 'scooter' : 'motorbike'
  if (kind === 'car') return /suv|x5|q7|model y|range|tiguan|sportage|tucson/.test(s) ? 'suv' : 'sedan'
  return undefined
}

/** A HomePod named after its room ("Living Room", the name from the Apple Home app) is called by its model on the card. */
export function modelName(kind: ItemKind, name: string, roomName?: string, variant?: string) {
  if (kind === 'homepod' && roomName && lower(name) === lower(roomName)) return variant === 'mini' ? 'HomePod mini' : 'HomePod'
  return undefined
}

/**
 * Free spot for a small device on a surface in the room (desk, unit, nightstand...): tried along the surface from the
 * ends toward the middle, skipping spots that already hold another item.
 */
function surfaceSpot(here: Item[], kind: ItemKind, kinds: ItemKind[], fits: (c: { kind: ItemKind; x: number; z: number; rot: number; y: number }) => boolean) {
  const half0 = CATALOG[kind].size[0] / 2 + 0.03
  for (const k of kinds) {
    for (const s of here.filter((i) => i.kind === k)) {
      const half = Math.max(0, (s.len ?? CATALOG[k].size[0]) / 2 - half0)
      for (const f of [1, -1, 0.7, -0.7, 0.35, -0.35, 0]) {
        const lx = half * f
        const at = { x: s.x + lx * Math.cos(s.rot), z: s.z - lx * Math.sin(s.rot), rot: s.rot }
        const top = surfaceAt(here, at.x, at.z)
        if (!top || top.item.id !== s.id || !fits({ kind, ...at, y: top.y })) continue
        return { p: at, y: top.y }
      }
    }
  }
  return null
}

/** Preferred surfaces of devices placed on surfaces (automatic plan): kitchen appliances on the counter, speakers on the unit... */
const ON_SURFACE: Partial<Record<ItemKind, ItemKind[]>> = {
  coffeeMachine: ['kitchenCounter'],
  kettle: ['kitchenCounter'],
  microwave: ['kitchenCounter'],
  airFryer: ['kitchenCounter'],
  speaker: ['tvUnit', 'nightstand', 'desk', 'dresser', 'shoeCabinet'],
  soundbar: ['tvUnit'],
  computer: ['desk'],
  router: ['tvUnit', 'shoeCabinet', 'desk', 'dresser'],
  nas: ['tvUnit', 'desk', 'shoeCabinet'],
  printer: ['desk', 'dresser'],
  tableLamp: ['nightstand', 'dresser', 'desk'],
  airQuality: ['desk', 'nightstand', 'tvUnit'],
  humidifier: ['nightstand', 'dresser', 'desk'],
}

const SINGLETON: ItemKind[] = ['tv', 'console', 'radiator', 'boiler', 'diffuser', 'robotVacuum', 'door', 'tempSensor', 'alarmPanel']
const DOMAIN_ORDER = ['climate', 'water_heater', 'media_player', 'humidifier', 'light', 'fan', 'vacuum', 'lawn_mower', 'cover', 'valve', 'lock', 'alarm_control_panel', 'siren', 'camera', 'device_tracker', 'binary_sensor', 'sensor', 'switch']

const WALL_PREF: Partial<Record<ItemKind, Side[]>> = {
  acUnit: ['back', 'left', 'right'],
  radiator: ['front', 'left', 'right'],
  boiler: ['back', 'left', 'right'],
  camera: ['back', 'left'],
  motionSensor: ['front', 'left', 'right'],
  tempSensor: ['left', 'right', 'front'],
  wallSwitch: ['front', 'left'],
  plug: ['left', 'right', 'front', 'back'],
  wallLight: ['back', 'left', 'right'],
  ledStrip: ['back', 'left'],
  mirrorLight: ['back'],
  window: ['back', 'left', 'right'],
  door: ['front', 'left'],
  alarmPanel: ['front', 'left'],
}

export interface GenerateResult {
  layout: Layout
  /** Entities skipped because they could not be placed or are duplicates */
  unplaced: string[]
}

export function generateLayout(registry: HaRegistry, entities: Entities): GenerateResult {
  const areas = registry.areas.length ? registry.areas : [{ area_id: 'home', name: tc('place', 'Home'), icon: null }]
  const typed = areas
    .map((a) => ({ area: a, type: roomType(a) }))
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type))

  // Shelf packing: the target row width comes from the total width.
  const totalW = typed.reduce((s, ty) => s + SIZE[ty.type][0], 0)
  const rowsN = Math.max(1, Math.ceil(totalW / 14))
  const target = (totalW / rowsN) * 1.15
  const rows: { area: HaArea; type: RoomType }[][] = [[]]
  let acc = 0
  for (const ty of typed) {
    const w = SIZE[ty.type][0]
    if (acc + w > target && rows[rows.length - 1].length) {
      rows.push([])
      acc = 0
    }
    rows[rows.length - 1].push(ty)
    acc += w
  }

  const rooms: Room[] = []
  const roomTypeOf = new Map<string, RoomType>()
  const maxRowW = Math.max(...rows.map((r) => r.reduce((s, ty) => s + SIZE[ty.type][0], 0)))
  let z = 0
  for (const row of rows) {
    const rowW = row.reduce((s, ty) => s + SIZE[ty.type][0], 0)
    const stretch = Math.min(1.2, maxRowW / rowW)
    const depth = Math.max(...row.map((ty) => SIZE[ty.type][1]))
    let x = 0
    for (const ty of row) {
      const w = Math.round(SIZE[ty.type][0] * stretch * 4) / 4
      const room: Room = { id: uid('room'), name: ty.area.name, x, z, w, d: depth, floor: FLOOR[ty.type], areaId: ty.area.area_id, ...(ROOM_KIND[ty.type] ? { type: ROOM_KIND[ty.type] } : {}) }
      rooms.push(room)
      roomTypeOf.set(room.id, ty.type)
      x += w
    }
    z += depth
  }

  // Center the house on the origin.
  const minX = Math.min(...rooms.map((r) => r.x))
  const maxX = Math.max(...rooms.map((r) => r.x + r.w))
  const maxZ = Math.max(...rooms.map((r) => r.z + r.d))
  const ox = Math.round(((minX + maxX) / 2) * 4) / 4
  const oz = Math.round((maxZ / 2) * 4) / 4
  for (const r of rooms) {
    r.x -= ox
    r.z -= oz
  }

  // Interior doors first (every room reachable), then the furniture templates, leaving the doorways free.
  const items: Item[] = connectRooms({ id: 'gen', name: '', rooms, items: [] })
  for (const room of rooms) {
    ctx = { room, rooms }
    template(roomTypeOf.get(room.id)!, room, items)
  }
  ctx = null

  const roomByArea = new Map(rooms.map((r) => [r.areaId, r]))
  const itemsIn = (room: Room) => items.filter((i) => inRoom(room, i.x, i.z))
  const unplaced: string[] = []
  const skip = new Set(registry.skip)
  // Power strip item → common stem of its outlets (entity_id without the trailing number)
  const stripStem = new Map<string, string>()
  const stemOf = (id: string) => id.replace(/[_-]?\d+$/, '')

  const candidates = Object.values(entities)
    .filter((e) => !skip.has(e.entity_id) && DOMAIN_ORDER.includes(domainOf(e.entity_id)))
    .sort((a, b) => DOMAIN_ORDER.indexOf(domainOf(a.entity_id)) - DOMAIN_ORDER.indexOf(domainOf(b.entity_id)))

  for (const e of candidates) {
    const model = registry.entityModel?.[e.entity_id] ?? ''
    const kind = kindFor(e, model)
    if (!kind) continue
    const name = friendlyName(e)
    const lname = foldName(name)

    // Room: the HA area first, else a room name in the entity name, else a sensible room for the kind.
    let room = roomByArea.get(registry.entityArea[e.entity_id] ?? undefined)
    if (!room) room = rooms.find((r) => lname.includes(foldName(r.name)))
    if (!room && any(TV, /backlight/).test(lname)) room = rooms.find((r) => itemsIn(r).some((i) => i.kind === 'tv'))
    if (!room && kind === 'boiler') room = rooms.find((r) => roomTypeOf.get(r.id) === 'kitchen')
    if (!room && (kind === 'acUnit' || kind === 'radiator' || kind === 'boiler')) room = rooms.find((r) => roomTypeOf.get(r.id) === 'living')
    if (!room && kind === 'alarmPanel') room = rooms.find((r) => roomTypeOf.get(r.id) === 'entrance') ?? rooms[0]
    if (!room) {
      unplaced.push(e.entity_id)
      continue
    }

    const here = itemsIn(room)
    // A TV backlight is not a separate item but an extra entity of the TV and its backlight option.
    // A headboard light is not a separate wall light but the bed's headboard light (strip).
    const bedHere = here.find((i) => i.kind === 'bed')
    if (bedHere && ['light', 'switch'].includes(domainOf(e.entity_id)) && BED_HEADBOARD.test(lname)) {
      bedHere.extras = [...(bedHere.extras ?? []), e.entity_id]
      bedHere.led = 'strip'
      continue
    }
    // Numbered outlets with the same stem (switch.bed_outlet_1, _2) are outlets of the same power strip: one item.
    if (kind === 'powerStrip') {
      const strip = here.find((i) => i.kind === 'powerStrip' && stripStem.get(i.id) === stemOf(e.entity_id))
      if (strip) {
        strip.extras = [...(strip.extras ?? []), e.entity_id]
        continue
      }
    }
    // A diffuser's light is not a separate item but the diffuser's ring strip (extra entity + led 'strip').
    const diffHere = here.find((i) => i.kind === 'diffuser')
    if (diffHere && kind === 'diffuser' && domainOf(e.entity_id) === 'light' && diffHere.entityId !== e.entity_id) {
      diffHere.extras = [...(diffHere.extras ?? []), e.entity_id]
      diffHere.led = 'strip'
      continue
    }
    // Fan, switch and light of a ceiling fan in one item: the fan or switch is the main entity, the light is the light kit (led 'under')
    const fanHere = here.find((i) => i.kind === 'ceilingFan')
    if (fanHere && kind === 'ceilingFan' && fanHere.entityId !== e.entity_id) {
      Object.assign(fanHere, withBinding(fanHere, e.entity_id))
      if (domainOf(e.entity_id) === 'light') fanHere.led = 'under'
      continue
    }
    // Pump, light and heater of a pool in one item
    const poolHere = here.find((i) => i.kind === 'pool')
    if (poolHere && kind === 'pool' && poolHere.entityId !== e.entity_id) {
      Object.assign(poolHere, withBinding(poolHere, e.entity_id))
      continue
    }
    const tvHere = here.find((i) => i.kind === 'tv')
    if (tvHere && domainOf(e.entity_id) === 'light' && (TV_BACKLIGHT.test(`${name} ${e.entity_id}`) || (kind === 'ledStrip' && TV.test(lname)))) {
      tvHere.extras = [...(tvHere.extras ?? []), e.entity_id]
      tvHere.led = 'back'
      continue
    }
    // Bind to an unbound template item of the same kind.
    const spare = here.find((i) => i.kind === kind && !i.entityId)
    if (spare) {
      spare.entityId = e.entity_id
      spare.name = name
      continue
    }
    if (SINGLETON.includes(kind) && here.some((i) => i.kind === kind)) {
      unplaced.push(e.entity_id)
      continue
    }

    const tv = here.find((i) => i.kind === 'tv')
    let p: { x: number; z: number; rot: number }
    let y: number | undefined
    // HomePod: on the unit on the other side of the TV; without a TV on a nightstand; else a corner on the floor.
    const homepodAt = () => {
      if (tv) {
        const c = Math.cos(tv.rot)
        const s = Math.sin(tv.rot)
        const at = { x: tv.x - 0.86 * c + 0.02 * s, z: tv.z + 0.86 * s + 0.02 * c, rot: tv.rot }
        const top = surfaceAt(here, at.x, at.z)
        if (top) return { p: at, y: top.y }
      }
      const stand = here.find((i) => i.kind === 'nightstand' && !here.some((o) => o.y != null && Math.hypot(o.x - i.x, o.z - i.z) < 0.2))
      return stand ? { p: { x: stand.x, z: stand.z, rot: stand.rot }, y: surfaceAt(here, stand.x, stand.z)?.y } : null
    }
    const onTop = kind === 'deskCamera' ? ['desk', 'tvUnit', 'nightstand', 'dresser', 'shoeCabinet', 'coffeeTable'] : ON_SURFACE[kind]
    const hp = kind === 'homepod' ? homepodAt() : onTop ? surfaceSpot(here, kind, onTop as ItemKind[], (c) => checkItem({ id: 'gen', name: '', rooms, items }, c).ok) : null
    if (kind === 'console' && tv) {
      p = { x: tv.x + 0.86, z: tv.z + 0.02, rot: tv.rot }
      y = 0.5
    } else if (hp) {
      p = hp.p
      y = hp.y
    } else if (CEILING.includes(kind)) {
      // Ceiling: the middle of the room, the next one beside it (further for fans so the blades fit)
      const n = here.filter((i) => CEILING.includes(i.kind)).length
      p = { x: room.x + room.w / 2 + n * (kind === 'ceilingFan' ? 1.2 : 0.9), z: room.z + room.d / 2, rot: 0 }
    } else if (CATALOG[kind].wall) {
      p = wallSlot(room, here, kind, WALL_PREF[kind] ?? ['left', 'right', 'back', 'front'])
    } else {
      const desk = here.find((i) => i.kind === 'desk')
      if (desk && (kind === 'vibrationSensor' || kind === 'deskLamp' || kind === 'monitor')) {
        p = { x: desk.x - 0.55, z: desk.z, rot: 0 }
        y = 0.75
      } else p = floorSlot(room, here, kind)
    }
    const it: Item = { id: uid('it'), kind, x: p.x, z: p.z, rot: p.rot, y, entityId: e.entity_id, name, variant: variantFor(kind, e, model) }
    it.name = modelName(kind, name, room.name, it.variant) ?? it.name
    if (kind === 'console' && it.variant) it.len = CONSOLE_LEN[it.variant]
    if (kind === 'powerStrip') {
      stripStem.set(it.id, stemOf(e.entity_id))
      it.name = CATALOG.powerStrip.label
    }
    items.push(it)
  }

  // Power strips: outlets in number order (outlet 1 is the main entity), the smallest size (2-8) holding all bound outlets.
  const outletNo = (id: string) => Number(id.match(/(\d+)$/)?.[1] ?? 99)
  for (const it of items) {
    if (it.kind !== 'powerStrip' || !it.entityId) continue
    const ids = [it.entityId, ...(it.extras ?? [])].sort((a, b) => outletNo(a) - outletNo(b))
    const n = STRIP_SIZES.find((k) => k >= ids.length) ?? STRIP_SIZES[STRIP_SIZES.length - 1]
    Object.assign(it, { entityId: ids[0], extras: ids.slice(1), variant: String(n), len: stripWidth(n) })
  }

  // Bind the temperature and humidity sensors of the same area to an AC/boiler as extras (shown on the card and in the room value).
  for (const it of items) {
    if (!it.entityId || domainOf(it.entityId) !== 'climate') continue
    const room = rooms.find((r) => inRoom(r, it.x, it.z))
    if (!room?.areaId) continue
    const extras = Object.values(entities)
      .filter((e) => domainOf(e.entity_id) === 'sensor' && ['temperature', 'humidity'].includes(String(e.attributes.device_class)))
      .filter((e) => registry.entityArea[e.entity_id] === room.areaId && !skip.has(e.entity_id))
      .map((e) => e.entity_id)
      .slice(0, 3)
    if (extras.length) it.extras = extras
  }

  return { layout: { version: 1, levels: [{ id: uid('lvl'), name: '', rooms, items }] }, unplaced }
}
