import { zh, type Dict } from './zh'

let currentDict: Dict = zh

export function t(): Dict {
  return currentDict
}

export function setDict(dict: Dict): void {
  currentDict = dict
}

export { zh }