const _ = require('lodash')
const Promise = require('bluebird')
const Mysql = require('../Mysql')
const TickerDataLoader = require('./TickerDataLoader')

module.exports = class DataLoader {
  constructor(config, testConf) {
    this.config = config
    this.testConf = testConf
    this.buffer = []
    this.bufferIndex = -1
    this.TABLE = `history_${testConf.timeframe}`

    this.db = new Mysql(this.config.db)
    this.loaders = []
    this.loadersMap = {}
  }

  async getDateRange(tickers, from = null, to = null) {
    tickers = `"${tickers.join('","')}"`
    from = from || '1123-01-01'
    to = to || '9999-01-01'

    const params = [from, to, from, to]
    const minTimeSql = ' AND time >= ? AND time <= ?'
    const maxTimeSql = ' AND time >= ? AND time <= ?'

    const sql = `
      SELECT 
        (SELECT MIN(time) FROM ${this.TABLE} WHERE ticker IN (${tickers}) ${minTimeSql} LIMIT 1) as min,
        (SELECT MAX(time) FROM ${this.TABLE} WHERE ticker IN (${tickers}) ${maxTimeSql} LIMIT 1) as max
      `

    const limits = await this.db.sql(sql, params)
    return limits[0]
  }

  async getDataGenerator() {
    const promises = this.loaders.map(loader => loader.getData())
    const tickersData = await Promise.all(promises)

    const res = {}
    this.testConf.tickers.forEach((ticker, i) => {
      res[ticker] = tickersData[i]
    })
    return res
  }

  async prepareData(from, to) {
    this.testConf.tickers.forEach((ticker) => {
      const loader = new TickerDataLoader(
        this.TABLE, ticker, this.db, from, to, this.testConf.dataLimit
      )

      this.loadersMap[ticker] = loader
      this.loaders.push(loader)
    })
  }

  async getFuturePrice(ticker, bars = 1) {
    const loader = this.loadersMap[ticker]
    if (!loader)
      return null

    return loader.getFuturePrice(bars)
  }

  getAllData() {
    return this.loaders[0].getAllData()
  }

  getPrices(data, type, limit) {
    if (limit) {
      const to = data.length
      const from = to - limit
      data = data.slice(from, to)
    }

    return _.map(data, type);
  }
}
