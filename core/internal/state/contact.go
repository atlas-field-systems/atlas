package state

// ContactArrival is the last persisted evidence for an identity Core monitors.
type ContactArrival struct {
	Kind, ID  string
	LastHeard *int64
}

// ContactArrivals collects the current subjects before the caller changes their contact.
func ContactArrivals(tx *Tx, query string) ([]ContactArrival, error) {
	rows, err := tx.Query(query, tx.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var arrivals []ContactArrival
	for rows.Next() {
		var arrival ContactArrival
		if err := rows.Scan(&arrival.Kind, &arrival.ID, &arrival.LastHeard); err != nil {
			return nil, err
		}
		arrivals = append(arrivals, arrival)
	}
	return arrivals, rows.Err()
}
