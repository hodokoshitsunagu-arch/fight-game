/**
 * scenes.js — the places you can cast in.
 *
 * Content, not configuration, which is why it is not in `settings.js`: this
 * list gets added to and argued over, while settings holds the numbers the
 * renderer reads every frame. Mixing them would mean a copy edit and a shader
 * tweak landing in the same file.
 *
 * Every coordinate here was resolved through `StreetViewService` with the
 * project's own key, and had to satisfy three things at once — see
 * `self-created/verify-scenes.mjs`, which is the script that checked them:
 *
 *   links >= 2    there is a road graph, so walking goes somewhere
 *   copyright     Google's car coverage, not an uploaded photosphere
 *   drift < 200m  the panorama is still where it was asked for
 *
 * Seven of eighteen candidates failed. Giza, Hagia Sophia, Marrakech and
 * Bangkok's Grand Palace resolve only to standalone photospheres, which are not
 * part of the road graph and report zero links by definition. The Bund is 6.6km
 * from the nearest official panorama, because Street View does not cover
 * mainland China.
 *
 * Google retires panoramas, so this list should be re-verified rather than
 * trusted indefinitely.
 */

export const SCENES = [
  {
    id: 'times-square',
    flag: '🇺🇸',
    zh: '时代广场',
    en: 'Times Square',
    place: 'New York, USA',
    lat: 40.756978,
    lng: -73.985881,
    blurb: '广告牌的峡谷。四面八方都是发光的屏幕,法术的辉光在这里不是最亮的东西——它得和整条街的霓虹抢注意力。'
  },
  {
    id: 'shibuya',
    flag: '🇯🇵',
    zh: '涩谷十字路口',
    en: 'Shibuya Crossing',
    place: 'Tokyo, Japan',
    lat: 35.659499,
    lng: 139.700513,
    blurb: '人潮的十字。绿灯一亮,几百人从五个方向同时涌进路口。在这里施法,像在一场持续的人流里凿出一块静止。'
  },
  {
    id: 'eiffel',
    flag: '🇫🇷',
    zh: '埃菲尔铁塔',
    en: 'Eiffel Tower',
    place: 'Paris, France',
    lat: 48.85844,
    lng: 2.294514,
    blurb: '钢铁的骨架。抬头是十九世纪的铆接桁架,脚下是战神广场的碎石。冰霜长枪擦过塔基时,尺度感才真正出来。'
  },
  {
    id: 'acropolis',
    flag: '🇬🇷',
    zh: '雅典卫城',
    en: 'Acropolis',
    place: 'Athens, Greece',
    lat: 37.972484,
    lng: 23.727587,
    blurb: '两千五百年的白石。帕特农的柱子被晒成蜜色。这里的法术不该显得喧闹——古迹本身已经是最强的存在感。'
  },
  {
    id: 'red-square',
    flag: '🇷🇺',
    zh: '红场',
    en: 'Red Square',
    place: 'Moscow, Russia',
    lat: 55.753826,
    lng: 37.620709,
    blurb: '洋葱顶与红砖。圣瓦西里大教堂的螺旋色块几乎是卡通的,反而和程序化特效意外地合。广场极空旷,适合放大范围法术。'
  },
  {
    id: 'taj-mahal',
    flag: '🇮🇳',
    zh: '泰姬陵',
    en: 'Taj Mahal',
    place: 'Agra, India',
    lat: 27.174927,
    lng: 78.042112,
    blurb: '对称到极致的白。水池、甬道、穹顶,一切都沿中轴线镜像。任何不对称的特效放在这里都会显得刺眼——这是构图上的挑战。'
  },
  {
    id: 'machu-picchu',
    flag: '🇵🇪',
    zh: '马丘比丘',
    en: 'Machu Picchu',
    place: 'Cusco, Peru',
    lat: -13.163319,
    lng: -72.545433,
    blurb: '云雾里的梯田。海拔 2430 米,石墙沿山脊层层退让。背景没有一条直路,行走是沿着古道的台阶往上。'
  },
  {
    id: 'table-mountain',
    flag: '🇿🇦',
    zh: '桌山',
    en: 'Table Mountain',
    place: 'Cape Town, South Africa',
    lat: -33.962128,
    lng: 18.409537,
    blurb: '被削平的山。桌山顶端平得不像自然物,云像桌布一样从边缘垂下来。开阔到没有任何遮挡,是十个场景里天空占比最大的。'
  },
  {
    id: 'burj-khalifa',
    flag: '🇦🇪',
    zh: '哈利法塔',
    en: 'Burj Khalifa',
    place: 'Dubai, UAE',
    lat: 25.197218,
    lng: 55.274391,
    blurb: '828 米的垂直线。镜头必须仰起来才能看到顶,这是唯一一个「抬头」比「平视」更有意义的场景。玻璃幕墙会把法术的光反射回来。'
  },
  {
    id: 'opera-house',
    flag: '🇦🇺',
    zh: '悉尼歌剧院',
    en: 'Sydney Opera House',
    place: 'Sydney, Australia',
    lat: -33.856886,
    lng: 151.215376,
    blurb: '贝壳的白瓷片。屋顶是一百多万块瓷砖拼出的曲面,背后就是海港。水面、白瓷、蓝天——色调最干净的一个。'
  }
];

/** The scene a session opens on. */
export const DEFAULT_SCENE = SCENES[0];

export function findScene(id) {
  return SCENES.find((scene) => scene.id === id) ?? null;
}
