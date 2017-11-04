const moment = require('moment')

module.exports = class TickerDataLoader {
  constructor(table, ticker, db, from, to, limit = 2) {
    this.DATA_LIMIT = limit * 10 + 10000

    this.limit = limit
    this.ticker = ticker
    this.db = db
    this.globalFrom = from
    this.globalTo = to
    this.table = table

    this.buffer = []
    this.bufferIndex = -1
  }

  async bufferData() {
    let from = moment(this.globalFrom, 'YYYY-MM-DD').subtract(1, 'second').format('YYYY-MM-DD HH:mm:ss')

    if (this.buffer.length)
      from = this.buffer[this.buffer.length - 1].time
    const data = await this.db.getData(
      '*',
      this.table,
      'ticker = ? AND time > ? AND time <= ? ORDER BY time ASC LIMIT ?',
      [this.ticker, from, this.globalTo, this.DATA_LIMIT]
    )
    this.buffer.push(...data)
    return data.length
  }

  async getData() {
    this.bufferIndex++
    if (this.bufferIndex > this.buffer.length - 1)
      await this.bufferData()

    const from = Math.max(this.bufferIndex - this.limit + 1, 0)
    const to = this.bufferIndex + 1
    return this.buffer.slice(from, to)
  }

  getAllData() {
    return this.buffer
  }

  async getFuturePrice(bars = 1) {
    const index = this.bufferIndex + bars
    if (index > this.buffer.length - 1)
      await this.bufferData()

    if (index > this.buffer.length - 1)
      return null

    return this.buffer[index]
  }
}
