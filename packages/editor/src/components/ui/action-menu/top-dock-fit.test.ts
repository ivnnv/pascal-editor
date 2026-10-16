import { expect, test } from 'bun:test'
import { fitTopDock } from './top-dock-fit'

const region = { left: 0, right: 1000 }
const menu = { left: 350, top: 12, width: 300, height: 48 }
const box = (left: number, right: number, top = 10, bottom = 44) => ({ left, right, top, bottom })

test('a top-docked menu stays centred while nothing along the top is in its way', () => {
  expect(fitTopDock(menu, region, [box(0, 150), box(850, 1000)])).toEqual({ x: 0, y: 0 })
})

test('it slides into the nearest gap wide enough when chrome covers its centred spot', () => {
  expect(fitTopDock(menu, region, [box(0, 150), box(600, 1000)])).toEqual({ x: -58, y: 0 })
})

test('it drops below the chrome when no gap in its row fits it', () => {
  expect(fitTopDock(menu, region, [box(0, 400), box(560, 1000)])).toEqual({ x: 0, y: 40 })
})

test('chrome below the menu band never moves it', () => {
  expect(fitTopDock(menu, region, [box(300, 700, 80, 120)])).toEqual({ x: 0, y: 0 })
})

test('after dropping a row it dodges what sits in that row too', () => {
  const toolbars = [box(0, 400), box(560, 1000)]
  expect(fitTopDock(menu, region, [...toolbars, box(600, 1000, 60, 400)])).toEqual({
    x: -58,
    y: 40,
  })
})

test('a taller blocker on one side lets it tuck under the shorter one', () => {
  expect(fitTopDock(menu, region, [box(0, 400), box(560, 1000, 10, 60)])).toEqual({
    x: -98,
    y: 40,
  })
})
