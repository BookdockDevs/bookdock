/** Recommendation keys are stable identities; names are path-matching defaults. */
export interface CategoryTemplate {
  key: string
  name: string
  children?: readonly CategoryTemplate[]
}

export const CATEGORY_TEMPLATES: readonly CategoryTemplate[] = [
  { key: 'literature', name: '文学', children: [
    { key: 'literature.essays', name: '散文随笔' },
    { key: 'literature.poetry', name: '诗歌' },
    { key: 'literature.drama', name: '戏剧' },
    { key: 'literature.nonfiction', name: '纪实文学' },
    { key: 'literature.criticism', name: '文学理论与鉴赏' },
  ] },
  { key: 'fiction', name: '小说', children: [
    { key: 'fiction.realism', name: '社会现实' },
    { key: 'fiction.romance', name: '情感小说' },
    { key: 'fiction.science-fiction', name: '科幻小说' },
    { key: 'fiction.mystery', name: '悬疑推理' },
    { key: 'fiction.horror', name: '惊悚恐怖' },
    { key: 'fiction.historical', name: '历史小说' },
    { key: 'fiction.martial-arts', name: '武侠小说' },
  ] },
  { key: 'web-fiction', name: '网络小说', children: [
    { key: 'web-fiction.xuanhuan', name: '玄幻' },
    { key: 'web-fiction.fantasy', name: '奇幻' },
    { key: 'web-fiction.martial-arts', name: '武侠' },
    { key: 'web-fiction.xianxia', name: '仙侠' },
    { key: 'web-fiction.urban', name: '都市' },
    { key: 'web-fiction.realism', name: '现实' },
    { key: 'web-fiction.history', name: '历史' },
    { key: 'web-fiction.military', name: '军事' },
    { key: 'web-fiction.science-fiction', name: '科幻' },
    { key: 'web-fiction.mystery', name: '悬疑' },
    { key: 'web-fiction.games', name: '游戏' },
    { key: 'web-fiction.sports', name: '体育' },
    { key: 'web-fiction.romance', name: '言情' },
    { key: 'web-fiction.light-novel', name: '轻小说' },
  ] },
  { key: 'history', name: '历史传记', children: [
    { key: 'history.ancient-china', name: '中国古代史' },
    { key: 'history.modern-china', name: '中国近现代史' },
    { key: 'history.world', name: '世界历史' },
    { key: 'history.biography', name: '人物传记' },
  ] },
  { key: 'humanities', name: '人文社科', children: [
    { key: 'humanities.philosophy', name: '哲学' },
    { key: 'humanities.religion', name: '宗教' },
    { key: 'humanities.sociology', name: '社会学' },
    { key: 'humanities.psychology', name: '心理学' },
    { key: 'humanities.culture', name: '文化研究' },
    { key: 'humanities.politics', name: '政治' },
    { key: 'humanities.law', name: '法律' },
  ] },
  { key: 'business', name: '经济管理', children: [
    { key: 'business.economics', name: '经济学' },
    { key: 'business.finance', name: '金融投资' },
    { key: 'business.management', name: '商业管理' },
    { key: 'business.marketing', name: '市场营销' },
  ] },
  { key: 'science', name: '科学技术', children: [
    { key: 'science.popular', name: '科普' },
    { key: 'science.natural', name: '自然科学' },
    { key: 'science.computing', name: '计算机' },
    { key: 'science.engineering', name: '工程技术' },
    { key: 'science.medicine', name: '医学' },
  ] },
  { key: 'life', name: '生活成长', children: [
    { key: 'life.growth', name: '个人成长' },
    { key: 'life.health', name: '健康养生' },
    { key: 'life.fitness', name: '运动健身' },
    { key: 'life.leisure', name: '生活休闲' },
    { key: 'life.education', name: '教育学习' },
  ] },
]

export function categoryTemplatePath(key: string): string[] | undefined {
  for (const root of CATEGORY_TEMPLATES) {
    if (root.key === key) return [root.name]
    const child = root.children?.find((item) => item.key === key)
    if (child) return [root.name, child.name]
  }
  return undefined
}
