import { describe, expect, it } from 'vitest'

import { normalizeBookTitle } from './book-title'

describe('normalizeBookTitle', () => {
  it.each([
    ['《剑来》（烽火戏诸侯）.txt', { title: '剑来', author: '烽火戏诸侯', authors: ['烽火戏诸侯'] }],
    ['诡秘之主[精校版].txt', { title: '诡秘之主', versionName: '精校版' }],
    ['大奉打更人 - 笔趣阁.txt', { title: '大奉打更人' }],
    ['夜的命名术【完结+番外】.txt', { title: '夜的命名术', versionName: '完结+番外' }],
    ['间客（精校版全本）作者：猫腻.txt', { title: '间客', author: '猫腻', authors: ['猫腻'], versionName: '精校版全本' }],
    ['长夜难明 紫金陈著.txt', { title: '长夜难明', author: '紫金陈', authors: ['紫金陈'] }],
    ['《红楼梦》（清）曹雪芹著.txt', { title: '红楼梦', author: '曹雪芹', authors: ['曹雪芹'] }],
    ['三体-www.b520.cc.txt', { title: '三体' }],
    ['活着-txt下载站.txt', { title: '活着' }],
    ['某书名 作者：F3T33[1-32章][未完结].txt', { title: '某书名', author: 'F3T33', authors: ['F3T33'] }],
    ['某书名[1-32章][未完结].txt', { title: '某书名' }],
    ['某书名[作者：猫腻].txt', { title: '某书名', author: '猫腻', authors: ['猫腻'] }],
    ['某书名 作者: F3T33 [第1-50章完结].txt', { title: '某书名', author: 'F3T33', authors: ['F3T33'] }],
    ['某书名【更新至100章】.txt', { title: '某书名' }],
    ['某书名[100万字完结].txt', { title: '某书名' }],
    ['间客 作者：猫腻、唐家三少.txt', { title: '间客', author: '猫腻', authors: ['猫腻', '唐家三少'] }],
    ['好兆头 作者：尼尔·盖曼 / 特里·普拉切特.txt', { title: '好兆头', author: '尼尔·盖曼', authors: ['尼尔·盖曼', '特里·普拉切特'] }],
    ['设计模式 作者：Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides.txt', { title: '设计模式', author: 'Erich Gamma', authors: ['Erich Gamma', 'Richard Helm', 'Ralph Johnson', 'John Vlissides'] }],
    ['设计模式 埃里克·伽玛、理查德·赫尔姆 著.txt', { title: '设计模式', author: '埃里克·伽玛', authors: ['埃里克·伽玛', '理查德·赫尔姆'] }],
    ['好兆头 尼尔·盖曼 & 特里·普拉切特 著.txt', { title: '好兆头', author: '尼尔·盖曼', authors: ['尼尔·盖曼', '特里·普拉切特'] }],
    ['Good Omens by Neil Gaiman & Terry Pratchett.txt', { title: 'Good Omens', author: 'Neil Gaiman', authors: ['Neil Gaiman', 'Terry Pratchett'] }],
    ['大奉打更人 作者：卖报小郎君、会说话的肘子 - 笔趣阁.txt', { title: '大奉打更人', author: '卖报小郎君', authors: ['卖报小郎君', '会说话的肘子'] }],
    ['刘慈欣 - 《三体》.txt', { title: '三体', author: '刘慈欣', authors: ['刘慈欣'] }],
    ['《三体》- 刘慈欣.txt', { title: '三体', author: '刘慈欣', authors: ['刘慈欣'] }],
    ['[精选] 余华《活着》.txt', { title: '活着', author: '余华', authors: ['余华'] }],
    ['《三体》[精校版] - 刘慈欣.txt', { title: '三体', author: '刘慈欣', authors: ['刘慈欣'], versionName: '精校版' }],
    ['《好兆头》- 尼尔·盖曼、特里·普拉切特.txt', { title: '好兆头', author: '尼尔·盖曼', authors: ['尼尔·盖曼', '特里·普拉切特'] }],
    ['《百年孤独》（上海译文出版社）.txt', { title: '百年孤独' }],
    ['《平凡的世界》全三部.txt', { title: '平凡的世界' }],
    ['《三体》作者：刘慈欣[精校版].txt', { title: '三体', author: '刘慈欣', authors: ['刘慈欣'], versionName: '精校版' }],
    ['[校园] 偷偷藏不住 - 竹已.txt', { title: '[校园] 偷偷藏不住 - 竹已' }],
    ['[修仙] 凡人修仙传 - 忘语.txt', { title: '[修仙] 凡人修仙传 - 忘语' }],
  ])('normalizes %s', (fileName, expected) => {
    expect(normalizeBookTitle(fileName)).toEqual(expected)
  })

  it.each([
    ['《人类简史：从动物到上帝》.txt', '人类简史：从动物到上帝'],
    ['1984.txt', '1984'],
    ['中括号【人物】合法.txt', '中括号【人物】合法'],
    ['碟形世界1：颜色.txt', '碟形世界1：颜色'],
    ['（一）局长的.txt', '（一）局长的'],
    ['见证：著名作家的一生.txt', '见证：著名作家的一生'],
  ])('leaves %s untouched', (fileName, expectedTitle) => {
    expect(normalizeBookTitle(fileName).title).toBe(expectedTitle)
  })

  it('truncates to the chapter-title length cap', () => {
    expect(normalizeBookTitle(`${'长'.repeat(200)}.txt`).title).toHaveLength(120)
  })

  it('returns an empty title when nothing survives normalization', () => {
    expect(normalizeBookTitle('《》.txt').title).toBe('')
  })
})
