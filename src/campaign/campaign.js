/**
 * campaign.js — the five levels, as content.
 *
 * Content, not configuration, for the same reason `scenes.js` is: this file
 * gets rewritten every time the pacing feels wrong, while `settings.js` holds
 * the numbers the renderer reads every frame. A copy edit and a shader tweak
 * should never land in the same file.
 *
 * The shape is three levels deep:
 *
 *   level      two locations and a name
 *   location   a scene id, and the nodes walked through inside it
 *   node       one panorama: one encounter, one relic shard, one story beat
 *
 * A node's difficulty is a roster and a count — nothing else. There is no
 * escalation formula anywhere in the campaign, because a formula produces a
 * curve and what a level actually needs is an *author* saying "this one is two
 * sentries, so you can hear yourself think". `DummyField` takes the list
 * verbatim.
 *
 * Everything referenced here already exists:
 *   archetypes  `settings.enemyTypes` — normal, runner, tank, elite
 *   behaviours  `DummyField` — chase, wanderer, sentry
 *   spells      `ELEMENT_META` — ten elements plus repulse and heal
 *
 * Nothing in this file needs a new model, shader or ability. The whole
 * escalation is composition.
 */

/** Shorthand so the tables below read as encounter design, not as objects. */
const N = (behaviour) => ({ archetype: 'normal', behaviour });
const R = (behaviour) => ({ archetype: 'runner', behaviour });
const T = (behaviour) => ({ archetype: 'tank', behaviour });
const E = (behaviour) => ({ archetype: 'elite', behaviour });

export const LEVELS = [
  {
    id: 'first-chime',
    zh: '初鸣',
    en: 'First Chime',
    /*
     * Level one teaches exactly one thing: saying the name is the whole cast.
     * No modifiers, no zone shapes, nothing behind you on the opening node.
     * The sentries are there to be stood in front of and shot at while the
     * player works out that their own voice is the trigger.
     */
    unlocks: ['ice', 'thunder'],
    teaches: '说出法术的名字就会施放。转身，让它对准你要打的东西。',
    locations: [
      {
        sceneId: 'times-square',
        intro: '遗物在霓虹里跳了一下。它认得这条街——它在这里碎的。',
        nodes: [
          {
            count: 2,
            roster: [N('sentry'), N('sentry')],
            hint: '按住麦克风，说「冰霜长枪」。',
            beat: '碎片落进掌心，冷得像刚从冰里捞出来。街还在往前。'
          },
          {
            count: 3,
            roster: [N('sentry'), N('chase'), N('sentry')],
            hint: '试试「雷霆长枪」。名字不同，落点也不同。',
            beat: '第二枚碎片。广告牌的光在它表面走了一圈，像在读它。'
          }
        ]
      },
      {
        sceneId: 'shibuya',
        intro: '人潮的形状还在，人却不在了。遗物把这里的某一秒钉住了。',
        nodes: [
          {
            count: 3,
            roster: [N('chase'), N('sentry'), N('chase')],
            hint: '它们会走过来。等它进射程再喊。',
            beat: '碎片在斑马线正中。踩上去的时候，路口安静了半拍。'
          },
          {
            count: 3,
            roster: [N('chase'), N('chase'), N('sentry')],
            hint: '有一个在你身后。转过去。',
            beat: '第四枚。遗物开始发烫——它想去别的地方。'
          }
        ]
      }
    ]
  },

  {
    id: 'echo',
    zh: '回声',
    en: 'Echo',
    /*
     * Modifiers arrive here, and they arrive one axis at a time. Scale first
     * because it is the one you can see from across the street; tempo second
     * because it only reads once you already know the baseline speed.
     */
    unlocks: ['meteor', 'beam'],
    teaches: '在法术名前面加一个词，就能改变它。「更大的冰霜长枪」「迅捷的新星光束」。',
    locations: [
      {
        sceneId: 'eiffel',
        intro: '铁塔的影子落在草地上，方向不对——太阳在这里不管事了。',
        nodes: [
          {
            count: 3,
            roster: [N('chase'), R('chase'), N('sentry')],
            hint: '说「更大的烬火天降」。加一个词，落点整整大一圈。',
            beat: '碎片嵌在草皮里，周围一圈焦痕。它喜欢大的。'
          },
          {
            count: 4,
            roster: [R('chase'), N('wanderer'), N('chase'), R('chase')],
            hint: '跑得快的那种，用「迅捷的」抢在它到你面前之前。',
            beat: '快的那些倒下时几乎没有声音。碎片在它们中间。'
          }
        ]
      },
      {
        sceneId: 'acropolis',
        intro: '石头记得的比人多。遗物在这里安静下来，像在听。',
        nodes: [
          {
            count: 3,
            roster: [N('wanderer'), N('wanderer'), N('chase')],
            hint: '绕圈的那种不急着打。用「迟缓的」，让法术在原地多留一会儿。',
            beat: '碎片躺在柱础上，被磨得比石头还旧。'
          },
          {
            count: 4,
            roster: [R('chase'), N('wanderer'), N('chase'), N('sentry')],
            hint: '尺度和节奏可以一起说：「更大的迟缓的新星光束」。',
            beat: '第八枚。遗物的热度稳定了——一半的路走完了。'
          }
        ]
      }
    ]
  },

  {
    id: 'fracture',
    zh: '裂纹',
    en: 'Fracture',
    /*
     * Zone casts and footwork. The tank is introduced in the same level as the
     * zone spells on purpose: it is slow enough that placing something on the
     * ground ahead of it actually works, which is the lesson.
     */
    unlocks: ['snare', 'glacier'],
    teaches: '区域法术打的是地面，不是敌人。用方向键换个街角，让它们走进去。',
    locations: [
      {
        sceneId: 'red-square',
        intro: '广场太大了，大到能看清任何东西朝你走来——包括慢的那些。',
        nodes: [
          {
            count: 4,
            roster: [N('chase'), T('chase'), N('chase'), N('sentry')],
            hint: '「伏特陷阱」落在地上。让慢的那个自己走进去。',
            beat: '碎片在陷阱的焦圈中央，像是被留下来的。'
          },
          {
            count: 4,
            roster: [T('chase'), N('wanderer'), R('chase'), N('chase')],
            hint: '「冰川王冠」范围更大。人多的时候用它。',
            beat: '冰面下有东西在动。等你低头看，只剩碎片。'
          },
          {
            count: 5,
            roster: [T('chase'), N('chase'), R('chase'), N('wanderer'), N('sentry')],
            hint: '被围住就用方向键退一格，重新拉开距离。',
            beat: '广场空了。遗物指向南边，很坚决。'
          }
        ]
      },
      {
        sceneId: 'taj-mahal',
        intro: '倒影里的白比石头本身更白。遗物在水面上留下一道裂纹。',
        nodes: [
          {
            count: 4,
            roster: [N('chase'), T('chase'), N('wanderer'), R('chase')],
            hint: '窄路上，区域法术比直线法术划算。',
            beat: '碎片浮在水池边缘，一动不动。'
          },
          {
            count: 5,
            roster: [T('chase'), T('chase'), N('chase'), R('chase'), N('sentry')],
            hint: '两个厚的。先用陷阱定住一个，再处理另一个。',
            beat: '水面重新平了。裂纹留在原处。'
          },
          {
            count: 5,
            roster: [T('chase'), N('wanderer'), R('chase'), R('chase'), N('chase')],
            hint: '走位不是逃跑。换个角度，让它们排成一条线。',
            beat: '第十四枚。遗物烫得握不住了。'
          }
        ]
      }
    ]
  },

  {
    id: 'undertow',
    zh: '逆流',
    en: 'Undertow',
    /*
     * The one that matters.
     *
     * Mid-flight mutation — speaking a modifier *after* the spell has left your
     * hands — is the single thing this build does that nothing else does, and
     * it is also the thing nobody discovers on their own. It gets a whole level
     * and a hint that says it in plain words.
     */
    unlocks: ['void', 'phoenix'],
    teaches: '法术出手之后再说一个词，它会在飞行途中变。「裂隙斩」……「更大」。',
    locations: [
      {
        sceneId: 'machu-picchu',
        intro: '云在脚下。遗物在这里第一次自己动了一下。',
        nodes: [
          {
            count: 5,
            roster: [N('chase'), E('chase'), R('chase'), N('wanderer'), N('sentry')],
            hint: '先喊「裂隙斩」，等它飞出去，再喊「更大」。看着它变。',
            beat: '碎片悬在台阶上方，没有落下来。'
          },
          {
            count: 5,
            roster: [E('chase'), T('chase'), R('chase'), N('chase'), N('wanderer')],
            hint: '颜色也能改：「猩红的太阳凤凰」。',
            beat: '红色的余烬顺着梯田往下滚了很久。'
          },
          {
            count: 6,
            roster: [E('chase'), N('chase'), R('chase'), T('chase'), N('wanderer'), R('chase')],
            hint: '出手之后再改颜色，一样有效。',
            beat: '第十七枚。云散了一条缝。'
          }
        ]
      },
      {
        sceneId: 'table-mountain',
        intro: '山顶是平的，平得不像自然会做的事。',
        nodes: [
          {
            count: 5,
            roster: [E('chase'), R('chase'), R('chase'), N('chase'), N('sentry')],
            hint: '快的那些，出手后补「迅捷」比一开始就说更准。',
            beat: '碎片卡在岩缝里，边缘已经被风磨圆了。'
          },
          {
            count: 6,
            roster: [E('chase'), T('chase'), N('wanderer'), R('chase'), N('chase'), R('chase')],
            hint: '一句话里可以改两次。试试看能改到什么程度。',
            beat: '风停了。遗物不烫了，改成一下一下地跳。'
          },
          {
            count: 6,
            roster: [E('chase'), E('chase'), T('chase'), R('chase'), N('chase'), N('wanderer')],
            hint: '两个精英。飞行中变调是用来救一次打歪的。',
            beat: '第二十枚。只剩最后一段路。'
          }
        ]
      }
    ]
  },

  {
    id: 'resonance',
    zh: '共鸣',
    en: 'Resonance',
    /*
     * Nothing new is taught mechanically — everything here is a combination of
     * what the first four levels handed over. What *is* new is that mana
     * finally matters: the counts are high enough that casting the biggest
     * version of everything runs the bar dry, so `repulse` and `heal` stop
     * being curiosities and become the way out.
     */
    unlocks: ['singularity', 'worldtree', 'repulse', 'heal'],
    teaches: '法力有限。「力场震退」推开围上来的，「翠绿治愈」把血补回来。',
    locations: [
      {
        sceneId: 'burj-khalifa',
        intro: '塔尖看不见。遗物的每一次跳动，玻璃幕墙都跟着响一次。',
        nodes: [
          {
            count: 6,
            roster: [E('chase'), T('chase'), R('chase'), N('chase'), R('chase'), N('wanderer')],
            hint: '「引力奇点」把它们拉到一起，然后一次解决。',
            beat: '碎片被吸到奇点残留的中心，转了一圈才停。'
          },
          {
            count: 7,
            roster: [E('chase'), E('chase'), T('chase'), R('chase'), R('chase'), N('chase'), N('wanderer')],
            hint: '法力见底之前留一发「力场震退」。',
            beat: '幕墙上的倒影里，有一瞬间不是你。'
          },
          {
            count: 7,
            roster: [E('chase'), T('chase'), T('chase'), R('chase'), N('chase'), R('chase'), E('chase')],
            hint: '「世界树绽放」持续时间长，适合守一个路口。',
            beat: '根须退回地下。第二十三枚。'
          },
          {
            count: 8,
            roster: [E('chase'), E('chase'), T('chase'), R('chase'), R('chase'), N('chase'), N('wanderer'), T('chase')],
            hint: '血低了就喊「翠绿治愈」。它和别的法术抢同一条法力。',
            beat: '塔安静下来。遗物几乎完整了。'
          }
        ]
      },
      {
        sceneId: 'opera-house',
        intro: '最后一段。海风里有金属的味道，遗物知道自己要去哪。',
        nodes: [
          {
            count: 6,
            roster: [E('chase'), T('chase'), R('chase'), R('chase'), N('chase'), N('sentry')],
            hint: '前四关学的东西，从这里开始要一起用。',
            beat: '碎片在台阶上，海水正好漫到下一级。'
          },
          {
            count: 7,
            roster: [E('chase'), E('chase'), R('chase'), T('chase'), N('chase'), R('chase'), N('wanderer')],
            hint: '区域法术封路，直线法术收尾。',
            beat: '帆一样的屋顶下，回声比外面长两倍。'
          },
          {
            count: 8,
            roster: [E('chase'), E('chase'), T('chase'), T('chase'), R('chase'), R('chase'), N('chase'), N('wanderer')],
            hint: '奇点 + 飞行中变调，一次清掉一片。',
            beat: '第二十七枚。最后一枚在海边。'
          },
          {
            count: 8,
            roster: [E('chase'), E('chase'), E('chase'), T('chase'), T('chase'), R('chase'), R('chase'), N('chase')],
            hint: '没有新东西了。用你会的。',
            beat: '遗物完整了，然后安静下来。世界还在原地——只是你走过了它。'
          }
        ]
      }
    ]
  }
];

/** Flat list of nodes in play order, so progress is a single index. */
export function flattenNodes(levels = LEVELS) {
  const flat = [];
  levels.forEach((level, levelIndex) => {
    level.locations.forEach((location, locationIndex) => {
      location.nodes.forEach((node, nodeIndex) => {
        flat.push({
          ...node,
          levelIndex,
          locationIndex,
          nodeIndex,
          level,
          location,
          /* The last node of a location is where the world changes rather than
           * the street — it is a chapter transition, not a step. */
          lastOfLocation: nodeIndex === location.nodes.length - 1,
          lastOfLevel:
            nodeIndex === location.nodes.length - 1 &&
            locationIndex === level.locations.length - 1
        });
      });
    });
  });
  return flat;
}

/** Every element unlocked up to and including a level. */
export function unlockedAt(levelIndex, levels = LEVELS) {
  const unlocked = [];
  for (let i = 0; i <= levelIndex && i < levels.length; i++) unlocked.push(...levels[i].unlocks);
  return unlocked;
}

export const TOTAL_NODES = flattenNodes().length;
