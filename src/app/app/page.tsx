import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppClient from "./app-client";

export default async function LedgerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: memberships } = await supabase.from("household_members").select("household_id, role, households(id,name,reporting_currency)").eq("user_id", user.id).eq("active", true).limit(1);
  const membership = memberships?.[0];
  if (!membership) redirect("/onboarding");
  const household = Array.isArray(membership.households) ? membership.households[0] : membership.households;
  if (!household) redirect("/onboarding");
  const householdId = membership.household_id;
  const [{ data: entries }, { data: proposals }, { data: investments }, { data: valuations }, { data: members }] = await Promise.all([
    supabase.from("ledger_entries").select("*").eq("household_id", householdId).order("occurred_at", { ascending: false }),
    supabase.from("proposals").select("*").eq("household_id", householdId).order("submitted_at", { ascending: false }),
    supabase.from("investments").select("*").eq("household_id", householdId).order("created_at"),
    supabase.from("investment_valuations").select("*").eq("household_id", householdId).order("value_date"),
    supabase.from("household_members").select("user_id, role, profiles(display_name)").eq("household_id", householdId),
  ]);
  return <AppClient household={{ id: householdId, name: household.name, reportingCurrency: household.reporting_currency }} userId={user.id} role={membership.role} entries={entries || []} proposals={proposals || []} investments={investments || []} valuations={valuations || []} members={members || []}/>;
}
