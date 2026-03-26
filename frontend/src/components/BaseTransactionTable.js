import React from 'react';

/**
 * Purely presentational transaction table.
 *
 * Column definition shape:
 *   {
 *     key: string,                            // unique key
 *     header: string | ReactNode,             // thead cell content
 *     headerClassName?: string,               // extra class on <th>
 *     cellClassName?: string,                 // static extra class on <td>
 *     getCellClassName?: (row) => string,     // dynamic extra class on <td>
 *     getCellProps?: (row) => object,         // extra props spread onto <td>
 *     kind?: 'amount',                        // standardized amount formatting + coloring
 *     getAmountValue?: (row) => number,       // required for kind==='amount' semantic coloring
 *     renderCell: (row, rowIndex) => ReactNode,
 *   }
 */
export default function BaseTransactionTable({
  columns,
  data = [],
  isLoading = false,
  emptyMessage = 'No transactions found.',
  rowKey = (row, i) => (row.id != null ? row.id : i),
  getRowClassName = () => '',
  filterRow = null,
  renderExtraRow = null,
  tableClassName = '',
  scrollClassName = '',
}) {
  const headerBaseClass =
    'border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400 whitespace-nowrap';

  return (
    <div className={scrollClassName || 'w-full overflow-x-auto'}>
      <table
        className={[
          'w-full border-collapse table-auto',
          tableClassName,
        ].filter(Boolean).join(' ')}
      >
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={[
                  headerBaseClass,
                  col.headerClassName || '',
                ].filter(Boolean).join(' ')}
              >
                {col.header}
              </th>
            ))}
          </tr>
          {filterRow}
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-8 py-8 text-center text-sm text-zinc-400"
              >
                Loading your data…
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-6 text-center text-sm text-zinc-400"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <React.Fragment key={rowKey(row, i)}>
                <tr
                  className={[
                    getRowClassName(row),
                  ].filter(Boolean).join(' ')}
                >
                  {columns.map((col) => (
                    (() => {
                      const isAmount = col.kind === 'amount';
                      const rawAmount = isAmount && typeof col.getAmountValue === 'function'
                        ? Number(col.getAmountValue(row))
                        : null;
                      const amountColorClass =
                        isAmount && rawAmount != null && !Number.isNaN(rawAmount)
                          ? (rawAmount < 0 ? 'text-rose-400' : 'text-emerald-400')
                          : '';

                      return (
                    <td
                      key={col.key}
                      className={[
                        'border-b border-zinc-800 px-4 py-3 text-zinc-100',
                        isAmount ? 'text-right font-mono tabular-nums' : '',
                        amountColorClass,
                        col.cellClassName || '',
                        col.getCellClassName ? col.getCellClassName(row) : '',
                      ].filter(Boolean).join(' ')}
                      {...(col.getCellProps ? col.getCellProps(row) : {})}
                    >
                      {col.renderCell(row, i)}
                    </td>
                      );
                    })()
                  ))}
                </tr>
                {renderExtraRow ? renderExtraRow(row, i) : null}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
