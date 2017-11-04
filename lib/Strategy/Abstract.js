const _ = require('lodash')
const talib = require('talib')
const indicators = require('technicalindicators')
const Promise = require('bluebird')

module.exports = class Abstract {
  constructor(config, testConfig, services) {
    this.inPosition = false

    this.config = config
    this.testConfig = testConfig
    this.tickers = testConfig.tickers
    this.stepCounter = 0
    this.ended = false

    this.indicators = talib
    this.indicators.exec = Promise.promisify(this.indicators.execute)
    _.merge(this, services)
  }

  end() {
    this.ended = true
  }

  _getCurrentPrice(prices) {
    if (_.isArray(prices))
      return prices[prices.length - 1].close

    if (prices.close)
      return prices.close[prices.close.length - 1]

    throw new Error('Prices is not an array of OHLC items nor object with close prices')
  }

  _getSupport(prices, period) {
    prices = prices.slice((prices.length - period), prices.length)
    return Math.min(...prices)
  }

  _getResistance(prices, period) {
    prices = prices.slice((prices.length - period), prices.length)
    return Math.max(...prices)
  }

  _getHeikinAshi(data) {
    const cols = ['open', 'high', 'low', 'close', 'volume']
    const transformed = {}

    cols.forEach((col) => {
      transformed[col] = _.map(data, col)
    })

    transformed.timestamp = _.map(data, 'time')
    return indicators.HeikinAshi.calculate(transformed);
  }

  async doStep(time, data) {
    this.stepCounter++
    this.orderManager.printCapital(this.stepCounter)

    this.orderManager.setCurrentDate(time)
    this.tickers.forEach((ticker) => {
      const list = data[ticker]
      this.orderManager.setCurrentTickerPrice(ticker, list[list.length - 1])
    })
    await this.step(time, data)
  }

  init() {
    throw new Error('Method init must be overridden')
  }

  async step() {
    throw new Error('Method step must be overridden')
  }
}
