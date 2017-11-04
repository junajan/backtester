const numeral = require('numeral')
const moment = require('moment')
const fs = require('fs-extra')
const ejs = require('ejs')
const Table = require('cli-table2')
const ubique = require('ubique')
const path = require('path')
const opn = require('opn');


module.exports = class BacktestResult {
  constructor(config) {
    this.config = config
    this.capital = config.capital
  }

  getPercentageGrowth(item) {
    return Number(((item.end - item.start) / item.start * 100).toFixed(2))
  }

  getGrowthTable(start, stop) {
    const capital = this.capital
    let year = start
    const growth = {}
    do {
      const yearRow = {
        year,
        start: capital,
        profit: 0,
        end: capital,
        monthly: {}
      }

      for (let i = 1; i < 13; i++) {
        yearRow.monthly[i] = {
          month: i,
          start: capital,
          end: capital,
          profit: 0
        }
      }

      growth[year] = yearRow
    } while (++year <= stop)

    return growth
  }

  getCapitalGrowth(profits) {
    let capital = this.capital
    const growth = {
      capital: [capital],
      dates: [this.config.from]
    }

    Object.keys(profits).forEach((date) => {
      capital += profits[date]
      growth.dates.push(date)
      growth.capital.push(capital)
    })

    growth.dates.push(this.config.to)
    growth.capital.push(capital)
    return growth
  }

  investigateProfits(returns, orders, endCapital, stockData) {
    const startYear = Number(moment(this.config.from).format('YYYY'))
    const stopYear = Number(moment(this.config.to).format('YYYY'))
    const growth = this.getGrowthTable(startYear, stopYear)
    const yearPercentages = []

    Object.keys(returns).forEach((date) => {
      const year = moment(date).format('YYYY')
      const month = moment(date).format('M')
      const profit = returns[date]

      growth[year].monthly[month].profit += profit
      growth[year].profit += profit
    })

    let capital = this.capital
    let year = startYear
    do {
      const row = growth[year]
      row.start = capital
      row.end = row.start + row.profit
      row.percentage = this.getPercentageGrowth(row)

      let capitalMonth = capital
      for (let i = 1; i < 13; i++) {
        const rowMonth = row.monthly[i]
        rowMonth.start = capitalMonth
        rowMonth.end = rowMonth.start + rowMonth.profit
        rowMonth.percentage = this.getPercentageGrowth(rowMonth)

        capitalMonth = rowMonth.end
      }

      capital = row.end
      yearPercentages.push(row.percentage)
    } while (++year <= stopYear)

    const sharp = ubique.sharpe(yearPercentages)

    // ===== print results:
    const growthTable = this.printReturnsTable(growth)
    console.log('SharpRatio:', sharp)

    this.generateResultPage(returns, orders, growthTable, endCapital, stockData)
    // this.printChart(capitalGrowth)
  }

  _getPercentageChanges(orders) {
    return orders.map(order => order.profitTotal / order.initCapital)
  }

  _analyzeOrders(returns, orders) {
    const percentageChanges = this._getPercentageChanges(orders)
    const dd = ubique.drawdown(percentageChanges)

    const info = {
      total: orders.length,
      drawdown: Math.max(...dd.dd),
      drawdownRecovery: Math.max(...dd.ddrecov),

      winning: 0,
      losing: 0,

      winningPercent: 0,
      losingPercent: 0,

      average: 0,

      averageProfit: 0,
      averageLoss: 0,

      maxProfit: 0,
      maxLoss: 0,
      winningConsecutiveArr: [0],
      losingConsecutiveArr: [0],
    }

    if (!info.total)
      return info

    for (const o of orders) {
      const profitable = o.profitTotal > 0
      const profit = o.profitTotal

      info.average += profit

      if (profitable) {
        info.winning++

        info.maxProfit = Math.max(profit, info.maxProfit)
        info.averageProfit += profit

        info.winningConsecutiveArr[info.winningConsecutiveArr.length - 1]++
        info.losingConsecutiveArr.push(0)
      } else {
        info.winningConsecutiveArr.push(0)
        info.losingConsecutiveArr[info.losingConsecutiveArr.length - 1]++

        info.losing++
        info.maxLoss = Math.min(profit, info.maxLoss)
        info.averageLoss += profit
      }
    }

    info.averageProfit /= info.winning
    info.averageLoss /= info.losing
    info.average /= info.total

    info.winningPercent = info.winning / info.total
    info.losingPercent = info.losing / info.total

    info.losingConsecutive = Math.max(...info.losingConsecutiveArr)
    info.winningConsecutive = Math.max(...info.winningConsecutiveArr)

    return info
  }

  _getCapitalGrowth(orders) {
    let min = Number.MAX_VALUE
    let max = 0
    const growth = [
      [(new Date(this.config.from)).getTime(), this.config.capital]
    ]

    orders.map((order) => {
      min = Math.min(order.endCapital, min)
      max = Math.max(order.endCapital, max)
      return growth.push([
        (new Date(order.closeDate)).getTime(), order.endCapital
      ])
    })

    return {
      data: growth,
      min: min - Math.abs(min * 0.00005),
      max: max + Math.abs(max * 0.005)
    }
  }

  _getStockData(data, orders) {
    const info = {
      ticker: data[0].ticker,
      data: data.map(row => [
        (new Date(row.time)).getTime(),
        row.close
      ]),
      flags: [],
    }

    for (const row of orders) {
      const openText = `${Math.abs(row.amount)}x ${row.openPrice}`
      const closeText = `${Math.abs(row.amount)}x ${row.closePrice}`
      const color = row.profitTotal > 0 ? 'green' : 'red'

      if (row.amount > 0) {
        info.flags.push(...[{
          x: (new Date(row.openDate)).getTime(),
          title: 'BUY',
          text: `Buy ${openText}`
        }, {
          x: (new Date(row.closeDate)).getTime(),
          title: 'SELL',
          text: `Sell ${closeText}`,
          color
        }]
        )
      } else {
        info.flags.push(...[{
          x: (new Date(row.openDate)).getTime(),
          title: 'SHO',
          text: `Short ${openText}`
        }, {
          x: (new Date(row.closeDate)).getTime(),
          title: 'COV',
          text: `Cover ${closeText}`,
          color
        }]
        )
      }
    }

    return info
  }

  generateResultPage(returns, orders, growthTable, resultCapital, stockData) {
    const filename = path.join(__dirname, '../resources/result.html')
    const info = this._analyzeOrders(returns, orders)
    const growth = this._getCapitalGrowth(orders)
    const stockInfo = this._getStockData(stockData, orders)
    const strategyPath = path.join(__dirname, './Strategy', `${this.config.strategy}.js`)

    const data = {
      code: fs.readFileSync(strategyPath),
      stockInfo,
      config: this.config,
      info,
      capital: {
        growth,
        start: this.capital,
        end: resultCapital.total,
        profit: resultCapital.total - this.capital,
        percent: (resultCapital.total - this.capital) / this.capital
      },
      orders,
      growthTable,
      fc: n => numeral(n).format('$0,0.00'),
      fp: (n, format = '0.00%') => numeral(n / 100).format(format)
    }

    ejs.renderFile(filename, data, {}, (err, str) => {
      if (err)
        throw err

      const file = path.join(__dirname, '../results/result.html')
      fs.ensureDirSync(path.dirname(file))
      fs.writeFileSync(file, str)

      const backupName = `${[
        this.config.strategy,
        this.config.timeframe,
        this.config.tickers.join('_'),
        this.config.from,
        this.config.to
      ].join('-')}.html`
      const backupFile = path.join(__dirname, '../results/', backupName)
      fs.writeFileSync(backupFile, str)

      console.log("Results are written to '%s' file", file)
      process.exit() // TODO remove me
      opn(file)
    })
  }

  cropNumber(n, isPercentage = false) {
    return Number(n).toFixed(2) + (isPercentage ? '%' : '')
  }

  printReturnsTable(data) {
    const head = 'Year,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,Yr%'.split(',')
    const dataTotal = {
      head,
      rows: []
    }

    const table = new Table({
      head
    })

    const averagedMonths = {}
    Object.keys(data).forEach((year) => {
      const row = data[year]
      const tr = [year]
      const trClean = [year]

      for (let i = 1; i < 13; i++) {
        const rowMonth = row.monthly[i]
        tr.push(this.cropNumber(rowMonth.percentage, true))
        trClean.push(rowMonth.percentage)

        if (!averagedMonths[i])
          averagedMonths[i] = {
            count: 0,
            percentage: 0
          }

        averagedMonths[i].count++
        averagedMonths[i].percentage += rowMonth.percentage
      }

      tr.push(this.cropNumber(row.percentage, true))
      trClean.push(row.percentage)
      table.push(tr)
      dataTotal.rows.push(trClean)
    })

    const avgRow = ['Avg:']
    const avgRowClean = ['Avg:']
    for (let i = 1; i < 13; i++) {
      avgRow.push(
        averagedMonths[i].count
          ? this.cropNumber((averagedMonths[i].percentage / averagedMonths[i].count), true)
          : '0%'
      )

      avgRowClean.push(
        averagedMonths[i].count
          ? averagedMonths[i].percentage / averagedMonths[i].count
          : 0
      )
    }

    avgRowClean.push('')
    avgRow.push('')
    table.push(avgRow)
    dataTotal.rows.push(avgRowClean)

    return dataTotal
  }
}
