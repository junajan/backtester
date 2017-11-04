const _ = require('lodash')
const talib = require('talib')
const Promise = require('bluebird')
const Abstract = require('./Abstract')

const indicator = Promise.promisify(talib.execute)

module.exports = class Sma extends Abstract {
  init() {
    this.SMA_LEN = 2
    this.ticker = this.tickers[0]
  }

  async _getSizeByScale() {
    const tickerPrice = await this.orderManager.getPrice(this.ticker)
    const capital = this.orderManager.getFreeCapital()

    return capital / tickerPrice * 0.999
  }

  async _buy() {
    await this.orderManager.sell(this.ticker, await this._getSizeByScale())
    this.inPosition = true
  }

  async _closeTrade() {
    await this.orderManager.closeAll()
    this.inPosition = false
  }

  async step(time, data) {
    data = data[this.ticker]
    const prices = _.map(data, 'close')
    const price = prices[prices.length - 1]

    const smaRes = await indicator({
      name: 'SMA',
      startIdx: 0,
      endIdx: prices.length - 1,
      inReal: prices,
      optInTimePeriod: this.SMA_LEN
    })

    if (!smaRes)
      return console.error('ERR: undefined sma:'.red, prices, this.ticker)

    const sma5 = smaRes.result.outReal.pop()

    if (!this.inPosition && price < sma5)
      return this._buy()

    if (this.inPosition && price > sma5)
      return this._closeTrade()

    return Promise.resolve()
  }
}
