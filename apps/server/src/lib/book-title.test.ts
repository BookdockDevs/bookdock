import { describe, expect, it } from 'vitest'

import { normalizeBookTitle } from './book-title'

describe('normalizeBookTitle', () => {
  it.each([
    ['《剑来》（烽火戏诸侯）.txt', { title: '剑来' }],
    ['诡秘之主[精校版].txt', { title: '诡秘之主' }],
    ['大奉打更人 - 笔趣阁.txt', { title: '大奉打更人' }],
    ['夜的命名术【完结+番外】.txt', { title: '夜的命名术' }],
    ['间客（精校版全本）作者：猫腻.txt', { title: '间客', author: '猫腻' }],
    ['长夜难明 紫金陈著.txt', { title: '长夜难明', author: '紫金陈' }],
    ['《红楼梦》（清）曹雪芹著.txt', { title: '红楼梦', author: '曹雪芹' }],
    ['三体-www.b520.cc.txt', { title: '三体' }],
    ['活着-txt下载站.txt', { title: '活着' }],
    ['某书名 作者：F3T33[1-32章][未完结].txt', { title: '某书名', author: 'F3T33' }],
    ['某书名[1-32章][未完结].txt', { title: '某书名' }],
    ['某书名[作者：猫腻].txt', { title: '某书名', author: '猫腻' }],
    ['某书名 作者: F3T33 [第1-50章完结].txt', { title: '某书名', author: 'F3T33' }],
    ['某书名【更新至100章】.txt', { title: '某书名' }],
    ['某书名[100万字完结].txt', { title: '某书名' }],
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
