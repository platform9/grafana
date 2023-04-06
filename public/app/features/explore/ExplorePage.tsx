import { css } from '@emotion/css';
import { inRange } from 'lodash';
import React, { useEffect, useState } from 'react';
import { batch } from 'react-redux';
import { useWindowSize } from 'react-use';

import { SupplementaryQueryType } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { ErrorBoundaryAlert } from '@grafana/ui';
import { SplitPaneWrapper } from 'app/core/components/SplitPaneWrapper/SplitPaneWrapper';
import { useGrafana } from 'app/core/context/GrafanaContext';
import { useNavModel } from 'app/core/hooks/useNavModel';
import { GrafanaRouteComponentProps } from 'app/core/navigation/types';
import { getTimeRangeFromUrl, parseUrlState, stopQueryState } from 'app/core/utils/explore';
import { addListener, useDispatch, useSelector } from 'app/types';
import { ExploreQueryParams } from 'app/types/explore';

import { ExploreActions } from './ExploreActions';
import { ExplorePaneContainer } from './ExplorePaneContainer';
import { useExploreCorrelations } from './hooks/useExploreCorrelations';
import { useExplorePageTitle } from './hooks/useExplorePageTitle';
import { changeDatasource } from './state/datasource';
import { initializeExplore, urlDiff } from './state/explorePane';
import { splitClose, splitSizeUpdateAction, stateSave } from './state/main';
import { cleanSupplementaryQueryAction, runQueries, setQueriesAction } from './state/query';
import { updateTime } from './state/time';
import { getUrlStateFromPaneState } from './state/utils';

const styles = {
  pageScrollbarWrapper: css`
    width: 100%;
    flex-grow: 1;
    min-height: 0;
    height: 100%;
    position: relative;
  `,
};

function useURLMigration(params: ExploreQueryParams) {
  const dispatch = useDispatch();
  const panes = useSelector((state) => state.explore.panes);

  const timeZone = useSelector((state) => state.user.timeZone);
  const fiscalYearStartMonth = useSelector((state) => state.user.fiscalYearStartMonth);

  useEffect(() => {
    (async () => {
      const urlPanes = {
        left: parseUrlState(params.left),
        ...(params.right && { right: parseUrlState(params.right) }),
      };

      for (const [exploreId, pane] of Object.entries(urlPanes)) {
        /**
         * We want to initialize the pane only if:
         * */
        const { datasource, queries, range: initialRange, panelsState } = pane;
        const range = getTimeRangeFromUrl(initialRange, timeZone, fiscalYearStartMonth);

        if (panes[exploreId] === undefined) {
          dispatch(
            initializeExplore({
              exploreId,
              datasource,
              queries,
              range,
              // FIXME: get the actual width
              containerWidth: 1000,
              panelsState,
            })
          );

          continue;
        } else {
          const update = urlDiff(pane, getUrlStateFromPaneState(panes[exploreId]!));

          if (update.datasource) {
            await dispatch(changeDatasource(exploreId, datasource));
          }

          if (update.range) {
            //FIXME:  if in state we have sync = true, we should unsync
            dispatch(updateTime({ exploreId, rawRange: range.raw }));
          }

          if (update.queries) {
            dispatch(setQueriesAction({ exploreId, queries: pane.queries }));
          }

          if (update.queries || update.range) {
            dispatch(runQueries(exploreId));
          }
        }
      }

      // Close all the panes that are not in the URL but are still in the store
      // ie. because the user has navigated back after oprning the split view.
      Object.keys(panes)
        .filter((keyInStore) => !Object.keys(urlPanes).includes(keyInStore))
        .forEach((paneId) => dispatch(splitClose(paneId)));
    })();
  }, [params, dispatch]);
}

export function ExplorePage(props: GrafanaRouteComponentProps<{}, ExploreQueryParams>) {
  useURLMigration(props.queryParams);
  // FIXME: This should happen as part of URL changes, or at least only after URL has changed
  useExplorePageTitle();
  useExploreCorrelations();
  const dispatch = useDispatch();
  const { keybindings, chrome } = useGrafana();
  const navModel = useNavModel('explore');
  const [rightPaneWidthRatio, setRightPaneWidthRatio] = useState(0.5);
  const { width: windowWidth } = useWindowSize();
  const minWidth = 200;
  const exploreState = useSelector((state) => state.explore);

  const panes = useSelector((state) => state.explore.panes);

  useEffect(() => {
    //This is needed for breadcrumbs and topnav.
    //We should probably abstract this out at some point
    chrome.update({ sectionNav: navModel.node });
  }, [chrome, navModel]);

  useEffect(() => {
    keybindings.setupTimeRangeBindings(false);
  }, [keybindings]);

  useEffect(() => {
    // timeSrv (which is used internally) on init reads `from` and `to` param from the URL and updates itself
    // using those value regardless of what is passed to the init method.
    // The updated value is then used by Explore to get the range for each pane.
    // This means that if `from` and `to` parameters are present in the URL,
    // it would be impossible to change the time range in Explore.
    // We are only doing this on mount for 2 reasons:
    // 1: Doing it on update means we'll enter a render loop.
    // 2: when parsing time in Explore (before feeding it to timeSrv) we make sure `from` is before `to` inside
    //    each pane state in order to not trigger un URL update from timeSrv.
    const searchParams = locationService.getSearchObject();
    if (searchParams.from || searchParams.to) {
      locationService.partial({ from: undefined, to: undefined }, true);
    }

    return () => {
      for (const [, pane] of Object.entries(panes)) {
        stopQueryState(pane!.querySubscription);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatch is stable, doesn't need to be in the deps array
  }, []);

  // @ts-expect-error the return type of addListener is actually callable, but dispatch is not middleware-aware
  useEffect(() => {
    const unsubscribe = dispatch(
      addListener({
        predicate: (action) => action.type.startsWith('explore'),
        effect: async (action, { dispatch, cancelActiveListeners, delay }) => {
          cancelActiveListeners();
          await delay(200);

          console.log('saving state', action);

          // TODO: here we centralize the logic for persisting back Explore's state to the URL.
          // TODO: skip if last action was cleanup (or we are outside of explore)
          dispatch(stateSave());
        },
      })
    );

    return unsubscribe;
  }, [dispatch]);

  const updateSplitSize = (size: number) => {
    const evenSplitWidth = windowWidth / 2;
    const areBothSimilar = inRange(size, evenSplitWidth - 100, evenSplitWidth + 100);
    if (areBothSimilar) {
      dispatch(splitSizeUpdateAction({ largerExploreId: undefined }));
    } else {
      dispatch(
        splitSizeUpdateAction({
          largerExploreId: size > evenSplitWidth ? 'right' : 'left',
        })
      );
    }

    setRightPaneWidthRatio(size / windowWidth);
  };

  const hasSplit = Object.entries(panes).length > 1;
  let widthCalc = 0;
  if (hasSplit) {
    if (!exploreState.evenSplitPanes && exploreState.maxedExploreId) {
      widthCalc = exploreState.maxedExploreId === 'right' ? windowWidth - minWidth : minWidth;
    } else if (exploreState.evenSplitPanes) {
      widthCalc = Math.floor(windowWidth / 2);
    } else if (rightPaneWidthRatio !== undefined) {
      widthCalc = windowWidth * rightPaneWidthRatio;
    }
  }

  return (
    <div className={styles.pageScrollbarWrapper}>
      <ExploreActions exploreIdLeft={'left'} exploreIdRight={'right'} />

      <SplitPaneWrapper
        splitOrientation="vertical"
        paneSize={widthCalc}
        minSize={minWidth}
        maxSize={minWidth * -1}
        primary="second"
        splitVisible={hasSplit}
        paneStyle={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}
        onDragFinished={(size) => {
          if (size) {
            updateSplitSize(size);
          }
        }}
      >
        {Object.keys(panes).map((exploreId) => {
          return (
            <ErrorBoundaryAlert key={exploreId} style="page">
              <ExplorePaneContainer exploreId={exploreId} />
            </ErrorBoundaryAlert>
          );
        })}
      </SplitPaneWrapper>
    </div>
  );
}
