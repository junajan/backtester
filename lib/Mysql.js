const mysql = require('mysql')
const Promise = require('bluebird')
/**
 * MySQL Class for better usage
 *
 * Usage:
 *     get (resReport, "*", "u_prava", "1=1", null, "id", "ASC" )
 *     insert (resReport,"table", { ... values })
 *     update (resReport,"table", { ... values })
 *     sql ( resReport, "SELECT * FROM u_prava WHERE id IN (?)", [1,2,3] )
 *
 * Usage 2:
 * const DB = require('./mysql')(conf.mysql)
 *    DB.getData("*", "config", DB.print)
 *    DB.get("*", "config", DB.print)
 *    DB.insert("config", {const:"aaa", val:"bbb"}, DB.print)
 *    DB.update("config", {val:"bbb2"}, "const = ?", "aaa", DB.print)
 *    DB.get("*", "config", DB.print)
 *    DB.delete("config", "const = ?", "aaa", DB.print)
 *    DB.getData("*", "config", DB.print)
 */

module.exports = class Mysql {
  constructor(config) {
    this.config = config
    this.debug = !!config.debug
    this.pool = mysql.createPool(config)
  }

  print(sql, data) {
    if (this.debug)
      console.log(`QUERY: ${sql} | PARAMS: ${JSON.stringify(data)}`)
  }

  runQuery(sql, data) {
    return new Promise((resolve, reject) => {
      this.pool.getConnection((err, conn) => {
        if (err)
          return reject(err)

        this.print(sql, data)

        return conn.query(sql, data, (errQuery, rows) => {
          conn.release()
          return errQuery ? reject(errQuery) : resolve(rows)
        })
      })
    })
  }

  getData(...args) {
    let sql = ''
    if (args[0])
      sql = `SELECT ${args[0]}`

    if (args[1])
      sql += ` FROM ${args[1]}`

    if (args[2])
      sql += ` WHERE ${args[2]}`

    if (args[4])
      sql += ` ORDER BY ${args[4]}`

    if (args[4] && args[5])
      sql += ` ${args[5]}`

    if (args[6])
      sql += ` LIMIT ${args[6]}`

    return this.runQuery(sql, args[3] || [])
  }

  get(...args) {
    return this.getData(args[0], args[1], args[2], args[3], args[4], args[5], 1)
      .then(res => res[0] || null)
  }

  insert(...args) {
    let sql = 'INSERT '
    if (args[2]) sql += 'IGNORE '
    sql += `INTO ${args[0]} SET ? `

    return this.runQuery(sql, args[1])
  }

  insertMultiple(...args) {
    let sql = 'INSERT '
    if (args[2]) sql += 'IGNORE '
    sql += `INTO ${args[0]} VALUES ? `

    return this.runQuery(sql, [args[1]])
  }

  update(...args) {
    const values = args[1]
    const sqlVals = []

    let sql = `UPDATE ${args[0]} SET `
    const arr = []

    for (const j in values) {
      if (j[0] === '.')
        sqlVals.push(`${j.substr(1)} = ${args[1][j]}`)
      else {
        sqlVals.push(`${j} = ?`)
        arr.push(values[j])
      }
    }

    sql += sqlVals.join(', ')

    if (args[2])
      sql += ` WHERE ${args[2]}`

    if (!(args[3] instanceof Array))
      args[3] = [args[3]]

    for (const val of args[3])
      arr.push(val)

    return this.runQuery(sql, arr)
  }

  delete(...args) {
    const sql = `DELETE FROM ${args[0]} WHERE ${args[1] || '1=1'}`

    if (!(args[2] instanceof Array))
      args[2] = [args[2]]

    this.runQuery(sql, args[2])
  }

  sql(sql, params) {
    return this.runQuery(sql, params)
  }
}
