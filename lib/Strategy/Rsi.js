const _ = require('lodash')
const talib = require('talib')
const Promise = require('bluebird')
const Abstract = require('./Abstract')

const indicator = Promise.promisify(talib.execute)

module.exports = class Rsi extends Abstract {
  init() {
    this.inPosition = false
    this.ticker = this.tickers[0]

    this.RSI_LEN = 12
    this.RSI_LEN_ENTRY = 30
    this.RSI_LEN_EXIT = 55
  }

  async _getSizeByScale() {
    const tickerPrice = await this.orderManager.getPrice(this.ticker)
    const capital = this.orderManager.getFreeCapital()

    return Number(Number(capital / tickerPrice * 0.96).toFixed(6))
  }

  async _buy() {
    const size = await this._getSizeByScale()
    if (!size)
      return console.log('Not enough capital for this trade')

    this.inPosition = true
    return this.orderManager.buy(this.ticker, size)
  }

  async _closeTrade() {
    this.inPosition = false
    return this.orderManager.closeAll()
  }

  async step(time, data) {
    const prices = _.map(data[this.ticker], 'close')

    // newest ... oldest
    // prices = [122.15, 121.48, 122.06, 120.73, 120.87, 120.26, 119.47,
    // 118.38, 118.64, 118.83, 117.54, 117.78, 117.09, 116.85]
    // console.log("RSI2(prices) = ", rsi); //will return 9.43
    // prices = [122.15, 121.48, 122.06, 120.73, 120.87, 120.26, 119.47,
    // 118.38, 118.64, 118.83, 117.54, 117.78, 117.09, 116.85]

    const rsiRes = await indicator({
      name: 'RSI',
      startIdx: 0,
      endIdx: prices.length - 1,
      inReal: prices,
      optInTimePeriod: this.RSI_LEN
    });

    if (!rsiRes)
      return console.error('ERR: undefined rsi:'.red, prices)

    const rsi = rsiRes.result.outReal.pop()
    console.log('RSI:', rsi)
    process.exit() // TODO remove me

    if (this.inPosition) {
      if (rsi >= this.RSI_LEN_EXIT)
        return this._closeTrade()
    } else if (rsi <= this.RSI_LEN_ENTRY)
      return this._buy()
    return 1
  }
}
