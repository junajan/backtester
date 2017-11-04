require('colors')
const path = require('path')
const moment = require('moment')
const DataLoader = require('./DataLoader/DataLoader')
const OrderManager = require('./OrderManager')
const BacktestResult = require('./BacktestResult')
const Promise = require('bluebird')

module.exports = class Backtester {
  constructor(config) {
    this.config = config
  }

  init(testConfig) {
    const strategyPath = path.join('./Strategy', testConfig.strategy)

    this.DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss'
    this.testConfig = testConfig
    this.tickers = testConfig.tickers
    this.data = new DataLoader(this.config, testConfig)
    this.orders = new OrderManager(this.config, this.testConfig, this.data)
    // eslint-disable-next-line
    this.strategy = new (require(`./${strategyPath}`))(this.config, testConfig, {
      dataManager: this.data,
      orderManager: this.orders
    })

    return Promise.resolve()
  }

  async getBoundaries() {
    const { min, max } = await this.data.getDateRange(
      this.tickers,
      this.testConfig.from,
      this.testConfig.to
    )

    return {
      from: min ? moment(min).format(this.DATE_FORMAT) : null,
      to: max ? moment(max).format(this.DATE_FORMAT) : null
    }
  }

  printStats() {
    console.log(' == STATS == '.yellow)
    const result = new BacktestResult(this.testConfig)
    result.investigateProfits(
      this.orders.profits,
      this.orders.positions,
      this.orders.capital,
      this.data.getAllData()
    )
  }

  async run() {
    const { from, to } = await this.getBoundaries()
    this.testConfig.from = from
    this.testConfig.to = to

    if (!from || !to)
      throw new Error('No data for selected period')

    console.log(
      'Running backtest between dates %s and %s',
      from, to
    )

    await this.data.prepareData(from, to)
    await this.strategy.init()
    console.time('Backtest ended')
    console.time('BacktestRound ended')

    // eslint-disable-next-line
    while (true) {
      const data = await this.data.getDataGenerator()
      const dataFirstTicker = data[this.tickers[0]]

      if (dataFirstTicker.length === 0 || this.strategy.ended) {
        console.timeEnd('BacktestRound ended')
        break
      }

      const testTime = dataFirstTicker[dataFirstTicker.length - 1].time

      // skip if we don't have enough data
      if (dataFirstTicker.length < this.testConfig.dataLimit) {
        if (this.strategy.stepCounter)
          console.log('ERR: Not enough data for date %s ... skipping', testTime)
        continue
      }

      console.time('Round ended')
      await this.strategy.doStep(testTime, data)

      console.timeEnd('Round ended')
    }

    this.orders.closeAll()
    this.orders.printCapital('final')

    console.timeEnd('Backtest ended')

    this.printStats()
  }
}

process.on('unhandledRejection', (err) => {
  console.log('An unhandledRejection occurred'.red)
  console.log(`Rejection:`, err)
  process.exit()
});
