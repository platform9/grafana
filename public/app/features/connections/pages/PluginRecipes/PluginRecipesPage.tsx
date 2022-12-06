import { css } from '@emotion/css';
import React, { useState } from 'react';

import { LoadingPlaceholder, useStyles2 } from '@grafana/ui';
import { Page } from 'app/core/components/Page/Page';

import { CardGrid, CategoryHeader, NoResults, Search } from '../../components';

import { useGetAll } from './api';
import { useRecipesFilteredBySearch } from './hooks';

export function PluginRecipesPage() {
  const [searchTerm, setSearchTerm] = useState<string | undefined>();
  const styles = useStyles2(getStyles);

  const handleSearchChange = (e: React.FormEvent<HTMLInputElement>) => {
    setSearchTerm(e.currentTarget.value.toLowerCase());
  };

  const { data, error, isFetching } = useGetAll();
  const recipes = useRecipesFilteredBySearch(data, searchTerm);

  return (
    <Page navId={'connections-plugin-recipes'}>
      <Page.Contents>
        <Search onChange={handleSearchChange} />

        {/* We need this extra spacing when there are no filters */}
        <div className={styles.spacer} />

        <CategoryHeader iconName="database" label="Plugin Recipes" />

        {/* Loading */}
        {isFetching && <LoadingPlaceholder text="Loading..." />}

        {/* Error */}
        {error && <p>Error: {error}</p>}

        {!isFetching && recipes.length === 0 && <NoResults />}
        {!isFetching && recipes.length > 0 && <CardGrid items={recipes} />}
      </Page.Contents>
    </Page>
  );
}

const getStyles = () => ({
  spacer: css`
    height: 16px;
  `,
});