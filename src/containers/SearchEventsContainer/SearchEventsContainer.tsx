import React, { FC, useCallback, useMemo, useState, useRef } from "react";
import { orderBy } from "lodash";
import { useMediaQuery } from "react-responsive";
import { useLocation } from "react-router-dom";
import { Loader } from "semantic-ui-react";

import { useAppConfigContext, useLanguageConfigContext } from "../../app";
import useDocumentTitle from "../../hooks/useDocumentTitle";
import useSearchCards, { SearchCardsActionType } from "../../hooks/useSearchCards";
import { ORDER_DIRECTION, OR_QUERY_LIMIT_NUM } from "../../networking/constants";
import EventSearchService, { RenderableEvent } from "../../networking/EventSearchService";

import { MeetingCard } from "../../components/Cards/MeetingCard";
import useFilter from "../../components/Filters/useFilter";
import { EventsFilter } from "../../components/Filters/EventsFilter";
import { getDateText } from "../../components/Filters/SelectDateRange";
import { getSortingText } from "../../components/Filters/SelectSorting";
import {
  getCheckboxText,
  getSelectedOptions,
} from "../../components/Filters/SelectTextFilterOptions";
import FetchCardsStatus from "../../components/Shared/FetchCardsStatus";
import PageContainer from "../../components/Shared/PageContainer";
import SearchBar from "../../components/Shared/SearchBar";
import SearchPageTitle from "../../components/Shared/SearchPageTitle";
import ShowMoreCards from "../../components/Shared/ShowMoreCards";
import { CardsContainer } from "../CardsContainer";
import { SearchEventsContainerData } from "./types";
import { SEARCH_TYPE } from "../../pages/SearchPage/types";

import { strings } from "../../assets/LocalizedStrings";
import { FETCH_CARDS_BATCH_SIZE } from "../../constants/ProjectConstants";
import { screenWidths } from "../../styles/mediaBreakpoints";
import { fontSizes } from "../../styles/fonts";
import getTimeZoneDate from "../../utils/getTimeZoneName";

const SearchEventsContainer: FC<SearchEventsContainerData> = ({
  searchEventsState,
  bodies,
}: SearchEventsContainerData) => {
  const { firebaseConfig, municipality } = useAppConfigContext();
  const { language } = useLanguageConfigContext();

  const searchQueryRef = useRef(searchEventsState.query);
  const [searchQuery, setSearchQuery] = useState(searchEventsState.query);
  useDocumentTitle(
    searchQueryRef.current ? `${strings.events} -- ${searchQueryRef.current}` : strings.events
  );

  const dateRangeFilter = useFilter<string>({
    name: strings.date,
    initialState: searchEventsState.dateRange,
    defaultDataValue: "",
    textRepFunction: getDateText(language, municipality.timeZone),
  });
  const committeeFilter = useFilter<boolean>({
    name: strings.committee,
    initialState: searchEventsState.committees,
    defaultDataValue: false,
    textRepFunction: getCheckboxText,
    limit: OR_QUERY_LIMIT_NUM,
  });
  const sortFilter = useFilter<string>({
    name: "Sort",
    initialState: {
      by: "datetimeWeightedRelevance",
      order: ORDER_DIRECTION.desc,
      label: strings.most_relevant_first,
    },
    defaultDataValue: "",
    textRepFunction: getSortingText,
  });

  const fetchEvents = useCallback(async () => {
    const eventSearchService = new EventSearchService(firebaseConfig);
    const matchingEvents = await eventSearchService.searchEvents(searchQuery);
    const renderableEvents = await Promise.all(
      matchingEvents.map((matchingEvent) => eventSearchService.getRenderableEvent(matchingEvent))
    );
    const bodyIds = getSelectedOptions(committeeFilter.state);
    let filteredEvents = renderableEvents.filter(({ event }) => {
      if (bodyIds.length) {
        if (!event.body?.id) {
          //exclude events without a body
          return false;
        }
        if (!bodyIds.includes(event.body.id)) {
          //exclude body not in bodyIds
          return false;
        }
      }

      const timeZoneStartDate = getTimeZoneDate(
        new Date(dateRangeFilter.state.start),
        municipality.timeZone
      );
      const timeZoneEndDate = getTimeZoneDate(
        new Date(dateRangeFilter.state.end),
        municipality.timeZone
      );

      if (timeZoneStartDate || timeZoneEndDate) {
        if (!event.event_datetime) {
          //exclude events without a event_datetime
          return false;
        }
        if (timeZoneStartDate && event.event_datetime < timeZoneStartDate) {
          //exclude events before start date
          return false;
        }
        if (timeZoneEndDate) {
          //exclude events after end date
          const endDate = new Date(timeZoneEndDate);
          endDate.setUTCDate(endDate.getUTCDate() + 1);
          if (event.event_datetime > endDate) {
            return false;
          }
        }
      }

      return true;
    });

    filteredEvents = orderBy(
      filteredEvents,
      [sortFilter.state.by],
      [sortFilter.state.order as ORDER_DIRECTION]
    );
    return Promise.resolve(filteredEvents);
  }, [
    searchQuery,
    committeeFilter.state,
    dateRangeFilter.state,
    sortFilter.state,
    firebaseConfig,
    municipality.timeZone,
  ]);

  const isDesktop = useMediaQuery({ query: `(min-width: ${screenWidths.desktop})` });
  const [state, dispatch] = useSearchCards<RenderableEvent>(
    {
      batchSize: FETCH_CARDS_BATCH_SIZE - (isDesktop ? 1 : 0),
      visibleCount: 0,
      cards: [],
      fetchCards: true,
      error: null,
    },
    fetchEvents
  );

  const location = useLocation();
  const handleSearch = useCallback(() => {
    searchQueryRef.current = searchQuery;
    const queryParams = `?q=${searchQuery.trim().replace(/\s+/g, "+")}`;
    //# is because the react-router-dom BrowserRouter is used
    history.pushState({}, "", `#${location.pathname}${queryParams}`);
    dispatch({ type: SearchCardsActionType.FETCH_CARDS });
  }, [searchQuery, location, dispatch]);

  const handleShowMoreEvents = useCallback(
    () => dispatch({ type: SearchCardsActionType.SHOW_MORE_CARDS }),
    [dispatch]
  );

  const fetchEventsResult = useMemo(() => {
    if (state.fetchCards) {
      return <Loader active size="massive" />;
    } else if (state.error) {
      return <FetchCardsStatus>{state.error.toString()}</FetchCardsStatus>;
    } else if (state.cards.length === 0) {
      return <FetchCardsStatus>{strings.no_results_found}</FetchCardsStatus>;
    } else {
      const cards = state.cards
        .slice(0, state.visibleCount)
        .map(({ event, keyGrams, selectedContextSpan, selectedGram }) => {
          return {
            link: `/${SEARCH_TYPE.EVENT}/${event.id}`,
            jsx: (
              <MeetingCard
                event={event}
                tags={keyGrams}
                excerpt={selectedContextSpan}
                gram={selectedGram}
                query={searchQueryRef.current}
              />
            ),
            searchQuery: searchQueryRef.current,
          };
        });
      return (
        <>
          <FetchCardsStatus>{`${state.cards.length} ${SEARCH_TYPE.EVENT}`}</FetchCardsStatus>
          <CardsContainer cards={cards} />
        </>
      );
    }
  }, [state.fetchCards, state.error, state.cards, state.visibleCount]);

  const showMoreEvents = useMemo(() => {
    return state.visibleCount < state.cards.length && !state.fetchCards;
  }, [state]);

  return (
    <PageContainer>
      <SearchPageTitle>
        <h1 className="mzp-u-title-sm">{strings.event_search_results}</h1>
        <SearchBar
          placeholder={strings.search_topic_placeholder}
          query={searchQuery}
          setQuery={setSearchQuery}
          handleSearch={handleSearch}
        />
      </SearchPageTitle>
      <EventsFilter
        allBodies={bodies}
        filters={[committeeFilter, dateRangeFilter, sortFilter]}
        sortOptions={[
          {
            by: "datetimeWeightedRelevance",
            order: ORDER_DIRECTION.desc,
            label: strings.most_relevant_first,
          },
          { by: "pureRelevance", order: ORDER_DIRECTION.desc, label: strings.closest_match_first },
          { by: "event.event_datetime", order: ORDER_DIRECTION.desc, label: strings.newest_first },
          { by: "event.event_datetime", order: ORDER_DIRECTION.asc, label: strings.oldest_first },
        ]}
        handlePopupClose={handleSearch}
      />
      <p
        style={{
          fontSize: fontSizes.font_size_5,
        }}
      >
        {strings.disclaimer_start}{" "}
        <a
          rel="noopener noreferrer license external"
          href="https://cloud.google.com/speech-to-text"
          target="_blank"
        >
          Google Speech-to-Text
        </a>{" "}
        {strings.disclaimer_end}
      </p>
      {fetchEventsResult}
      <ShowMoreCards isVisible={showMoreEvents}>
        <button className="mzp-c-button mzp-t-secondary mzp-t-lg" onClick={handleShowMoreEvents}>
          {strings.show_more}
        </button>
      </ShowMoreCards>
    </PageContainer>
  );
};

export default SearchEventsContainer;
