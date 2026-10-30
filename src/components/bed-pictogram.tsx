import bedIn from "../assets/bed-in.svg";
import bedOut from "../assets/bed-out.svg";

/** Original TroniCare Admin bed pictograms with accessible observation names. */
export function BedPictogram({ state }: { state: "in_bed" | "out_of_bed" }) {
  return (
    <img
      className="care-bed-pictogram"
      src={state === "in_bed" ? bedIn : bedOut}
      alt={state === "in_bed" ? "In bed" : "Out of bed"}
      width={48}
      height={30}
    />
  );
}
