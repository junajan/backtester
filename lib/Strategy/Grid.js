const Abstract = require('./Abstract')

module.exports = class Grid extends Abstract {

  init() {
    // start with one piece of capital
    this.defaultScale = 1
    this.positionScale = this.defaultScale
    this.directionUp = true // LONG by default
    this.inPosition = false

    this.percentProfitTake = 4

    // one piece of capital is 50 USD
    this.onePiece = 100

    // work only with one ticker BTCUSD
    this.ticker = this.tickers[0]

    // this.TIME_FROM = 12
    // this.TIME_TO = 23
    // this.MIN_VOLUME = 100000
  }

  _upscale() {
    // double the position
    this.positionScale *= 2
  }

  async _getSizeByScale() {
    // current ticker price
    const tickerPrice = await this.orderManager.getPrice(this.ticker)
    const scale = this.positionScale
    // get scaled order size
    let orderSize = this.onePiece * scale

    // if order size is bigger than current free capital, ceil it
    if (orderSize > this.orderManager.capital.free)
      orderSize = this.orderManager.capital.free * 0.99

    // get number
    const positionSize = orderSize / tickerPrice
    return Number(positionSize.toFixed(6))
  }

  async _buy() {
    await this.orderManager.buy(this.ticker, await this._getSizeByScale())
    this.inPosition = true
  }

  async _sell() {
    await this.orderManager.sell(this.ticker, await this._getSizeByScale())
    this.inPosition = true
  }

  async step() {
    // data = data[this.ticker]
    // const volume = data[data.length - 1].volume
    // const hour = Number(moment(time).format('k'))

    // at the beginning just buy on the first tick
    // if (volume > this.MIN_VOLUME && !this.inPosition
    // && (hour > this.TIME_FROM && hour < this.TIME_TO)) {

    if (!this.inPosition) {
      this.positionScale = this.defaultScale
      await this._buy()
    } else {
      const position = this.orderManager.getOpenPositions()[this.ticker]
      if (!position) {
        this.inPosition = false
        return Promise.resolve()
      }

      // const currentCapital = this.orderManager.getCapital()

      // current profit on open position
      const profit = position.profit
      // current percentage profit on open position
      const profitPercent = position.profitPercent
      // const profitPercent = position.profit / currentCapital * 100

      // if the position does not have enough percentage profit / loss
      // continue with the next tick
      if (Math.abs(profitPercent) < this.percentProfitTake)
        return Promise.resolve()

      // close the position
      await this.orderManager.closeAll()

      // if it was profitable reset scale to the default
      if (profit > 0) {
        this.positionScale = this.defaultScale
      } else {
        // if the trade was not profitable - change direction and scale up
        this.directionUp = !this.directionUp
        this._upscale()
      }

      // if(profit > 0 && ((hour < this.TIME_FROM || hour > this.TIME_TO)
      //   || volume < this.MIN_VOLUME))
      // if(profit > 0 && ((hour < this.TIME_FROM || hour > this.TIME_TO)
      //   || volume < this.MIN_VOLUME))
      //   return this.inPosition = false

        // buy or sell based on direction
      if (this.directionUp)
        await this._buy()
      else
        await this._sell()
    }

    return Promise.resolve()
  }
}
