const _ = require('lodash')
const Abstract = require('./Abstract')

module.exports = class Heikin extends Abstract {
  init() {
    this.inPosition = false
    // work only with one ticker
    this.ticker = this.tickers[0]

    // for how long will we calculate support and resistance
    this.PERIOD = 10
  }

  _getSizeByScale() {
    const tickerPrice = this.orderManager.getPrice(this.ticker)
    const capital = this.orderManager.getFreeCapital()

    // some magic stuff here
    return capital / tickerPrice // * 0.999
  }

  async _buy() {
    this.inPosition = true
    return this.orderManager.buy(this.ticker, this._getSizeByScale())
  }

  // _sell () {
  //   this.orderManager.sell(this.ticker, this._getSizeByScale())
  //   this.inPosition = true
  // }

  async _closeTrade() {
    this.inPosition = false
    return this.orderManager.closeAll()
  }

  async step(time, data) {
    // work only with data for one ticker
    const tickerData = _.cloneDeep(data[this.ticker])
    // get latest close price from ticker
    const price = this._getCurrentPrice(tickerData)
    // remove last ticker from list
    tickerData.pop()
    // turn data to heikinAshi
    const heikin = this._getHeikinAshi(tickerData)
    // get support and resistance
    const res = this._getResistance(heikin.high, this.PERIOD)
    const sup = this._getSupport(heikin.low, this.PERIOD)

    // if we are in position
    if (this.inPosition) {
      const position = this.orderManager.getOpenPositions()[this.ticker]
      if (!position) {
        this.inPosition = false
        return Promise.resolve()
      }

      const positionIsLong = position.amount > 0

      if (positionIsLong && price < sup) {
        return this._closeTrade()
        // this._sell()
      }

      // if (!positionIsLong && price > res) {
      //   this._closeTrade()
      //   this._buy()
      // }

    // buy when price crosses resistance
    } else if (price > res) {
      return this._buy()

      // else if (price < sup)
      //   this._sell()
    }

    return Promise.resolve()
  }
}
