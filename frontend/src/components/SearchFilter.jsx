// src/components/SearchFilter.jsx

import React, { useState, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';

const FILTER_LABELS = {
  search:    'بحث',
  status:    'الحالة',
  type:      'نوع الجهاز',
  whitelist: 'القائمة البيضاء',
  blacklist: 'القائمة السوداء',
  risk:      'مستوى المخاطرة',
  priority:  'الأولوية',
  resolved:  'الحل',
  eventType: 'نوع الحدث',
  limit:     'عدد النتائج',
};

const SearchFilter = React.memo(function SearchFilter({
  filters,
  options,
  onFilterChange,
  onClearFilters
}) {
  const [expanded, setExpanded] = useState(false);

  const activeCount = useMemo(
    () =>
      Object.entries(filters).filter(
        ([key, val]) => key !== 'search' && val !== '' && val != null
      ).length,
    [filters]
  );

  const hasSearch = Boolean(filters.search);

  const toggleExpanded = useCallback(() => {
    setExpanded(e => !e);
  }, []);

  const handleInputChange = useCallback(
    e => {
      onFilterChange({ [e.target.name]: e.target.value });
    },
    [onFilterChange]
  );

  const handleClearSearch = useCallback(() => {
    onFilterChange({ search: '' });
  }, [onFilterChange]);

  return (
    <div className="search-filter">
      {/* Controls */}
      <div className="d-flex flex-wrap align-center gap-2 mb-3">
        {/* Search field */}
        <div className="position-relative flex-grow-1">
          <input
            type="text"
            name="search"
            className="form-control ps-10 pe-8"
            placeholder="بحث..."
            value={filters.search || ''}
            onChange={handleInputChange}
            aria-label="بحث"
          />
          <i
            className="fas fa-search icon-sm position-absolute top-50 start-0 translate-middle-y ps-3 text-muted"
            aria-hidden="true"
          />
          {hasSearch && (
            <button
              type="button"
              className="btn btn-ghost position-absolute top-50 end-0 translate-middle-y pe-3"
              onClick={handleClearSearch}
              aria-label="مسح البحث"
            >
              <i className="fas fa-times icon-sm" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Toggle advanced filters */}
        <button
          type="button"
          className="btn btn-outline d-flex align-center gap-1"
          onClick={toggleExpanded}
          aria-expanded={expanded}
        >
          <i
            className={`fas fa-${expanded ? 'times' : 'filter'}`}
            aria-hidden="true"
          />
          <span>{expanded ? 'إغلاق المرشحات' : 'المرشحات'}</span>
          {!expanded && activeCount > 0 && (
            <span className="badge">{activeCount}</span>
          )}
        </button>

        {/* Clear all */}
        {(hasSearch || activeCount > 0) && (
          <button
            type="button"
            className="btn btn-outline d-flex align-center gap-1"
            onClick={onClearFilters}
          >
            <i className="fas fa-eraser" aria-hidden="true" />
            <span>مسح الكل</span>
          </button>
        )}
      </div>

      {/* Advanced filters */}
      {expanded && (
        <div className="advanced-filters">
          <div className="grid gap-4">
            {Object.entries(options).map(([key, opts]) => (
              <div key={key} className="col-12 col-md-6 col-lg-3">
                <label htmlFor={`${key}-filter`} className="form-label">
                  {FILTER_LABELS[key] || key}
                </label>
                <select
                  id={`${key}-filter`}
                  name={key}
                  className="form-control"
                  value={filters[key] || ''}
                  onChange={handleInputChange}
                >
                  <option value="">
                    {`كل ${FILTER_LABELS[key] || key}`}
                  </option>
                  {opts.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

SearchFilter.displayName = 'SearchFilter';

SearchFilter.propTypes = {
  /** كائن القيم الحالية للمرشحات */
  filters: PropTypes.object.isRequired,
  /** خيارات المرشحات: { key: [ { value, label }, ... ] } */
  options: PropTypes.objectOf(
    PropTypes.arrayOf(
      PropTypes.shape({
        value: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
          .isRequired,
        label: PropTypes.string.isRequired,
      })
    )
  ).isRequired,
  onFilterChange: PropTypes.func.isRequired,
  onClearFilters: PropTypes.func.isRequired,
};

export default SearchFilter;
