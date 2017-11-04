const _ = require('lodash')
const moment = require('moment')
const Promise = require('bluebird')

module.exports = class OrderManager {
  constructor(config, testConfig, dataManager) {
    this.config = config
    this.dataManager = dataManager
    this.testConfig = testConfig

    if (!_.isObject(this.testConfig.slippage))
      this.testConfig.slippage = {}

    _.defaults(this.testConfig.slippage, {
      bars: 1,
      // by default use next bars open price as a trade price
      fn: (current, future) => future.open
    })

    this.testConfig.feesFn = this._getFeeFunction(this.testConfig.fees)

    this.openPositions = {}
    this.aggregatedPositions = {}
    this.positions = []

    this.capital = {
      total: testConfig.capital,
      free: testConfig.capital,
      used: 0
    }

    this.profits = {}

    // ====
    this.currentPrice = {}
    this.currentDate = null
  }

  _getFeeFunction(fee) {
    if (!fee)
      return () => 0

    if (!_.isObject(fee) || !!_.isNumber(fee))
      throw new Error('Fee is not recognized - use static number or object')

    if (_.isNumber(fee))
      return () => fee

    if (fee.type === '%')
      return (price, amount) => price * amount * fee.val / 100

    return () => Number(fee.val)
  }

  setCurrentDate(time) {
    this.currentDate = moment(time).format('YYYY-MM-DD HH:mm:ss')
  }

  printCapital(i = null) {
    const prefix = i ? `Round: ${i} | ` : ''
    console.log(` == ${prefix}%s | Capital: %f free | %f total`.green, this.currentDate, this.capital.free, this.capital.total.toFixed(2))
  }

  _normalize(n) {
    return Number((n).toFixed(2))
  }

  async getPrice(ticker, priceType = 'close') {
    const slippage = this.testConfig.slippage

    if (!slippage)
      return this.currentPrice[ticker][priceType]

    const price = await this.dataManager.getFuturePrice(ticker, slippage.bars)
    if (!price)
      return null

    return slippage.fn(this.currentPrice[ticker], price)
  }

  getFreeCapital() {
    return this.capital.free
  }

  getCapital() {
    return this.capital.total
  }

  getOpenPositions(ticker = null) {
    const positions = this.aggregatedPositions

    const tickers = Object.keys(positions)
    const vals = tickers.map((tickerPosition) => {
      const pos = _.clone(positions[tickerPosition])

      pos.currentPrice = this.currentPrice[tickerPosition].close
      pos.currentPriceTotal = pos.currentPrice * pos.amount
      pos.profit = this._normalize(pos.currentPriceTotal - pos.openPriceTotal)
      pos.profitPercent = this._normalize(pos.profit / pos.openPriceTotal * 100)

      if (pos.amount < 0)
        pos.profitPercent *= -1

      return pos
    })

    const profits = _.zipObject(tickers, vals)
    return ticker
      ? profits[ticker] || null
      : profits
  }

  isTickerOpen(ticker = null) {
    return !!this.aggregatedPositions[ticker]
  }

  async closeTicker(ticker, priceType) {
    const pos = this.aggregatedPositions[ticker]

    if (pos.amount > 0)
      return this.sell(ticker, pos.amount, priceType)
    return this.buy(ticker, Math.abs(pos.amount), priceType)
  }

  async closeAll(priceType) {
    const tickers = Object.keys(this.aggregatedPositions)
    if (!tickers.length)
      return;

    console.log('Closing open positions'.yellow)
    for (const ticker of tickers) {
      await this.closeTicker(ticker, priceType) // eslint-disable-line
    }
  }

  setCurrentTickerPrice(ticker, price) {
    this.currentPrice[ticker] = price
  }

  isFreeCapital(size) {
    return this.capital.free >= size
  }

  aggregateAllPositions(openPositions = this.openPositions) {
    this.aggregatedPositions = {}

    for (const ticker of Object.keys(openPositions)) {
      const positions = openPositions[ticker]
      const pos = _.clone(positions[0])

      for (let i = 1; i < positions.length; i++) {
        const newPos = positions[i]

        const totalAmount = newPos.amount + pos.amount
        pos.openPriceTotal = Math.abs(pos.openPrice * pos.amount + newPos.openPrice * newPos.amount)
        const weightenedPrice = Math.abs(pos.openPriceTotal / totalAmount)
        pos.openPrice = weightenedPrice
        pos.amount = totalAmount
      }
      this.aggregatedPositions[ticker] = pos
    }

    return this.aggregatedPositions
  }

  addOpenPosition(ticker, pos) {
    if (this.openPositions[ticker])
      this.openPositions[ticker].push(pos)
    else
      this.openPositions[ticker] = [pos]
  }

  updateCapital(amount, profit = 0) {
    if (profit)
      this.capital.total += profit

    this.capital.free += amount

    this.capital.free = Number(this.capital.free.toFixed(2))
    this.capital.total = Number(this.capital.total.toFixed(2))

    if (!profit)
      return 0

    if (this.profits[this.currentDate])
      this.profits[this.currentDate] += profit
    else
      this.profits[this.currentDate] = profit

    return this.capital.total
  }

  async getTradeInfo(ticker, priceType) {
    return {
      pos: this.aggregatedPositions[ticker],
      positions: this.openPositions[ticker],
      currentPrice: await this.getPrice(ticker, priceType)
    }
  }

  async buyTicker(ticker, amount, priceType) {
    const openPrice = await this.getPrice(ticker, priceType)
    const feesFn = this.testConfig.feesFn

    const position = {
      ticker,
      amount,
      openPriceWithoutFee: openPrice,
      openFee: feesFn(openPrice, amount),
      openDate: this.currentDate,
      closePrice: null,
      closeDate: null
    }

    position.openPrice = openPrice + position.openFee / amount
    position.openPriceTotal = openPrice * amount + position.openFee

    console.log('Buy %dx %s for price %f per share'.yellow, amount, ticker, openPrice)
    this.addOpenPosition(ticker, position)
    this.updateCapital(-position.openPriceTotal)
  }

  async cover(ticker, amount, priceType) {
    const { positions, currentPrice } = await this.getTradeInfo(ticker, priceType)
    const feesFn = this.testConfig.feesFn

    let profit = 0

    do {
      const pos = positions[0]
      const clone = _.clone(pos)
      const newPosAmount = Math.min(pos.amount + amount, 0)
      amount = Math.max(amount + pos.amount, 0)

      pos.closePriceWithoutFee = currentPrice
      pos.amount -= newPosAmount
      pos.closeFee = feesFn(currentPrice, Math.abs(pos.amount))

      pos.closePrice = currentPrice + Math.abs(pos.closeFee / pos.amount)
      pos.closePriceTotal = pos.closePrice * pos.amount
      pos.closeDate = this.currentDate
      pos.openPriceTotal = pos.openPrice * pos.amount

      pos.profitTotal = pos.closePriceTotal - pos.openPriceTotal
      pos.profitPercent = this._normalize(pos.profitTotal / pos.openPriceTotal * 100)

      profit += pos.profitTotal

      const capital = this.capital.total
      this.updateCapital(pos.closePriceTotal, pos.profitTotal)
      this._addClosedPosition(pos, capital)
      positions.splice(0, 1)

      if (newPosAmount) {
        clone.openPriceTotal = clone.openPrice * newPosAmount
        clone.amount = newPosAmount
        positions.unshift(clone)
      }
    } while (positions.length && amount)

    if (positions.length === 0) {
      delete this.openPositions[ticker]
      delete this.aggregatedPositions[ticker]
    }
    return profit
  }

  async buy(ticker, amount, priceType) {
    const { pos, currentPrice } = await this.getTradeInfo(ticker, priceType)

    let buyAmount = amount
    const buyTotal = Number(Number(amount * currentPrice).toFixed(6))

    if (!this.isFreeCapital(buyTotal))
      return console.log(
        'Not enough capital to buy %dx %s for price %f(=%f) - Current free capital %f'.red,
        amount,
        ticker,
        currentPrice,
        buyTotal,
        this.capital.free
      )

    // if we short, cover them first
    if (pos && pos.amount < 0) {
      const coverAmount = Math.min(-pos.amount, amount)
      buyAmount -= coverAmount
      const profit = await this.cover(ticker, coverAmount, priceType)
      console.log('Cover %dx %s for price %f per share - profit: %f'.yellow, coverAmount, ticker, currentPrice, profit.toFixed(2))
    }

    if (buyAmount) {
      await this.buyTicker(ticker, buyAmount, priceType)
    }

    this.aggregateAllPositions()
    return Promise.resolve()
  }

  async sellTicker(ticker, amount, priceType) {
    const { positions, currentPrice } = await this.getTradeInfo(ticker, priceType)
    const feesFn = this.testConfig.feesFn

    let profit = 0

    do {
      const pos = positions[0]
      const clone = _.clone(pos)
      const newPosAmount = Math.max(pos.amount - amount, 0)
      amount = Math.max(amount - pos.amount, 0)

      pos.closePriceWithoutFee = currentPrice
      pos.amount -= newPosAmount
      pos.closeFee = feesFn(currentPrice, pos.amount)

      pos.closePrice = currentPrice - pos.closeFee / pos.amount
      pos.closePriceTotal = currentPrice * pos.amount - pos.closeFee
      pos.closeDate = this.currentDate
      pos.openPriceTotal = pos.openPrice * pos.amount

      pos.profitTotal = pos.closePriceTotal - pos.openPriceTotal
      profit += pos.profitTotal

      pos.profitPercent = this._normalize(pos.profitTotal / pos.openPriceTotal * 100)

      const capital = this.capital.total
      this.updateCapital(pos.closePriceTotal, pos.profitTotal)
      this._addClosedPosition(pos, capital)
      positions.splice(0, 1)

      if (newPosAmount) {
        // TODO check if we should update fee and prices calculated from a fee
        // eg. buy 3 pieces, close 1 piece - should we update openFee for the rest of 2 positions?
        clone.openPriceTotal = clone.openPrice * newPosAmount
        clone.amount = newPosAmount
        positions.unshift(clone)
      }
    } while (positions.length && amount)

    if (positions.length === 0) {
      delete this.openPositions[ticker]
      delete this.aggregatedPositions[ticker]
    }
    return profit
  }

  async short(ticker, amount, priceType) {
    const { currentPrice } = await this.getTradeInfo(ticker, priceType)
    const feesFn = this.testConfig.feesFn

    const position = {
      ticker,
      amount: -amount,
      openPriceWithoutFee: currentPrice,
      openFee: feesFn(currentPrice, amount),
      openDate: this.currentDate,
      closePrice: null,
      closeDate: null
    }

    position.openPrice = currentPrice - position.openFee / amount
    position.openPriceTotal = position.openPrice * -amount
    console.log('Short %dx %s for price %f per share'.yellow, amount, ticker, position.openPrice)
    this.addOpenPosition(ticker, position)
    this.updateCapital(-position.openPriceTotal)
  }

  async sell(ticker, amount, priceType) {
    const { pos, currentPrice } = await this.getTradeInfo(ticker, priceType)
    let sellAmount = amount

    // if we have bought some, close them first
    if (pos && pos.amount > 0) {
      const coverAmount = Math.min(pos.amount, amount)
      sellAmount -= coverAmount
      const profit = await this.sellTicker(ticker, coverAmount, priceType)
      console.log('Sell %dx %s for price %f per share - profit: %f'.yellow, coverAmount, ticker, currentPrice, profit.toFixed(2))
    }

    if (sellAmount)
      await this.short(ticker, sellAmount, priceType)

    this.aggregateAllPositions()
  }

  _addClosedPosition(pos, initCapital) {
    pos.initCapital = initCapital
    pos.endCapital = this.capital.total
    this.positions.push(pos)
  }
}
