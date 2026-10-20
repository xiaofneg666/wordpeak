<script setup>
// 「怎么练才有效」方法论条:嵌在每个训练模块页头(terr-head 副题之后),
// 默认一行收起(mono kicker + 一句要领),点击展开 3-5 步编号实操。
// 设计原则:文字用 --text-3 弱化、紧凑、不抢内容——它是"随行的教练",不是主角。
import { ref } from 'vue'

const props = defineProps({
  view: { type: String, required: true },
})

// 每个模块的练法(方法与技巧库/记忆工坊同源,这里只保留"开练前该知道的最小集")
const TRAINING = {
  galaxy: {
    kicker: '怎么练才有效 · 词汇',
    one: '主动回忆优先于重读——答案先收走,先想再看',
    steps: [
      '点开一颗星,先遮住释义,努力回忆它的意思再翻面',
      '用星火问答自测,答错不要沮丧——错的那次提取也在加固记忆',
      '星系亮度就是记忆:变暗的星别急着全点亮,让 FSRS 决定复习节奏',
      '同族星连成的星座是你的联想网络,多在家族之间跳着看',
    ],
  },
  listening: {
    kicker: '怎么练才有效 · 精听五步',
    one: '盲听→逐句→跟读→连读标记→复述,一篇吃透胜过十篇泛听',
    steps: [
      '第一遍盲听:不看文本,抓大意,允许自己听不懂',
      '第二遍逐句:开着文本,放慢到 0.9 倍,一句一听懂',
      '跟读:跟着音频出声,耳朵跟不上嘴的地方就是你的弱点',
      '连读标记:把粘在一起的词(tur-non-the-light)划出来',
      '最后脱稿复述:能用自己的话讲出来,这篇才算吃透',
    ],
  },
  reading: {
    kicker: '怎么练才有效 · 精读与泛读',
    one: '选材走 i+1——95% 认识、5% 生词的文章才是甜点区',
    steps: [
      '先看选单上的「已学 N/M」命中数,挑略高于当前水平的篇目',
      '第一遍限时通读不停笔,训练容忍生词的能力',
      '第二遍查词:只查影响理解的关键词,点词即查义、标进复习队列',
      '读后做题验证理解,错题回原文定位那句',
    ],
  },
  speaking: {
    kicker: '怎么练才有效 · 影子跟读',
    one: '先跟读再复述——嘴跟不上耳朵的地方,就是差距所在',
    steps: [
      '先听音频 1-2 遍,注意语调起伏而不是单个词',
      '影子跟读:音频不停,落后半拍跟着说,像影子跟着人',
      '逐句过机器:词库 IPA 音素比对打分,红色音素单独练 3 遍',
      '最后脱稿:合上文本把整句复述出来',
    ],
  },
  writing: {
    kicker: '怎么练才有效 · 输出倒逼输入',
    one: '写不出来的地方,就是你输入还没织成网的地方',
    steps: [
      '造句阶段:用目标词写一句,强迫它进入你的产出词汇',
      '写完自查:搭配对不对?别造汉语直译的句子',
      '批改意见逐条看,只改一处也比对都不改强',
      '隔天把写过的话题重写一遍,对比进步',
    ],
  },
  grammar: {
    kicker: '怎么练才有效 · 产出性练习',
    one: '语法是装配不是背诵——零件在手,装得出句子才算会',
    steps: [
      '先读公式与讲解,理解这个结构"为什么"长这样',
      '看装配动画:零件怎么咬合,一目了然',
      '做题:错了立刻读 explain,弄懂错在哪一步',
      '错题次日回暗物质区重做一次,间隔重练才是掌握',
    ],
  },
  mistakes: {
    kicker: '怎么练才有效 · 错因归档',
    one: '错题不是污点,是暗物质——重做一题,就有一颗星亮起来',
    steps: [
      '每条错题先归类:是词没记住、语法没装对,还是听岔了',
      '词错→回学习舱重走三幕;语法错→深链回机械城重装',
      '重练通过后打亮暗星,别让暗物质区变成耻辱簿',
      '考前只看暗物质区,它是为你个人定制的复习提纲',
    ],
  },
  network: {
    kicker: '怎么练才有效 · 自由探索',
    one: '好奇心是最好的老师——把"该学什么"的压力换成"这两颗星为什么连着"',
    steps: [
      '点开一颗未学词,看它和哪些词同族、和哪些词跨族共现',
      '从一族跳到另一族,找路径:从 spect 怎么走到 bio',
      '拖一颗词到一颗未学词,看看你的注意力随之走到哪里',
      '没有目标的游荡是最高效的复习——它顺着你真正的好奇心走',
    ],
  },
}

const t = TRAINING[props.view] || null
const open = ref(false)
</script>

<template>
  <div v-if="t" class="htt" :class="{ open }">
    <button class="htt-row" @click="open = !open">
      <span class="htt-kicker">{{ t.kicker }}</span>
      <span class="htt-one">{{ t.one }}</span>
      <svg class="htt-caret" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" /></svg>
    </button>
    <ol v-if="open" class="htt-steps">
      <li v-for="(s, i) in t.steps" :key="i"><span class="htt-no">{{ i + 1 }}</span>{{ s }}</li>
    </ol>
  </div>
</template>

<style scoped>
.htt {
  margin: -6px 0 22px; max-width: 720px;
}
.htt-row {
  display: flex; align-items: center; gap: 10px; width: 100%;
  background: none; border: none; padding: 6px 0; cursor: pointer; text-align: left;
}
.htt-kicker {
  font-size: var(--fs-2xs); letter-spacing: 0.2em; color: var(--text-3);
  font-family: var(--mono, monospace); white-space: nowrap;
}
.htt-one { flex: 1; font-size: var(--fs-xs); color: var(--text-3); transition: color .18s ease; }
.htt-row:hover .htt-one { color: var(--text-2); }
.htt-caret { color: var(--text-3); transition: transform .22s ease; flex-shrink: 0; }
.htt.open .htt-caret { transform: rotate(180deg); }
.htt-steps {
  list-style: none; display: flex; flex-direction: column; gap: 8px;
  margin: 10px 0 0; padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px;
  animation: riseIn 0.3s var(--ease) both;
}
.htt-steps li { display: flex; gap: 10px; font-size: var(--fs-sm); color: var(--text-2); line-height: 1.75; }
.htt-no {
  flex-shrink: 0; width: 18px; height: 18px; margin-top: 2px; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: var(--fs-2xs); font-family: var(--mono, monospace); color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
}
</style>
