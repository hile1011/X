declare module 'sql.js' {
  namespace SqlJs {
    interface PreparedStatement {
      bind(params: any[]): void
      step(): boolean
      getAsObject(): Record<string, any>
      free(): void
    }

    interface Database {
      new (data?: Uint8Array): Database
      run(sql: string, params?: any[]): void
      exec(sql: string): void
      prepare(sql: string): PreparedStatement
      export(): Uint8Array
      close(): void
      getRowsModified(): number
    }

    interface SqlJsStatic {
      Database: new (data?: Uint8Array) => Database
    }
  }

  function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJs.SqlJsStatic>

  export = initSqlJs
}
