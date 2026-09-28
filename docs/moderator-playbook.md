# Moderator Playbook — Parishkar Purulia

Version 1.0 · For the first moderator. Read once, then keep this open while you work.

## 1\. What this platform is

Parishkar Purulia is a public record of civic problems across Purulia district. Citizens file reports with a live photo and GPS location. When someone claims a cleanup, other independent citizens on-site must confirm it — 3 confirmations in Purulia town, 2 in villages — before the report is marked resolved.

**Your job is not to decide who is right.** Your job is to make sure the rules are followed, and to review the small number of cases where the rules produce an ambiguous result. 

## 2\. What you can and cannot do

You can| You cannot  
---|---  
Approve a report or cleanup claim that has passed the checks| Mark a report resolved without on-site confirmation  
Reject a cleanup claim, with a written reason| Delete a report or its history  
Hide a report, with a written reason| See who filed a report (identities aren't stored)  
Hold a claim for further review| Change the rules (that needs a settings change, logged separately)  
Publish an official reply on a report| Post as "official" without verifying the sender first  
  
## 3\. Daily workflow (about 15 minutes)

  1. Open the admin panel (`admin.html` on the live site) and sign in.
  2. Check the queue of claims held for review — these are the ones an automatic check couldn't resolve on its own.
  3. For each held claim, look at: 
     * The original report photo and the cleanup photo
     * Distance from the reported spot (claim must be within 50 m; confirmations within 100 m)
     * Who confirmed it, how many, and from how many different networks
     * Whether the same confirmers keep showing up together (the system already flags this — see §5)
  4. Decide: approve, reject with a reason, or leave it for the second moderator if you're unsure.
  5. Every decision you make is already logged automatically with your action and reason — you don't need to keep a separate log.



## 4\. What a good claim looks like

  * Cleanup photo taken live, on-site, with GPS accuracy of 60 m or better
  * The claimant was within 50 m of the reported spot
  * Enough on-site confirmations from independent accounts (3 in town, 2 in a village) from at least 2 different networks (1 in a village, since villages often share one tower)
  * None of the confirmers has confirmed the same claimant's cleanups 3+ times together in the last 30 days — the system already checks this and holds the claim for you if it applies



## 5\. What the system already catches for you

You'll only see a claim in the queue if something needs a human look. The server has already refused or held, before it reaches you:

  * Claims or votes not taken live, on the Parishkar Purulia camera
  * Photos reused from elsewhere, or older than 2 hours by the time they're submitted as evidence
  * Confirmers who aren't at least 3 days old with some prior activity on the platform
  * The same confirmer pair working together 3+ times in 30 days (sent to you, not auto-rejected — it might be a genuinely small, active neighbourhood)
  * Report photos Google Vision flags as unsafe, showing a face, or showing nothing that looks like a civic problem at all (a selfie, food, a screenshot) — held automatically, same queue



So when something reaches you, treat it as a real judgment call, not a rubber stamp.

**If you are unsure, do not approve.** Leave it for the second moderator once there is one. A false approval is worse than a delayed one. 

## 6\. What not to do

  * Never try to work out or reveal who filed a report — the platform doesn't store that in a way you can see, and it should stay that way
  * Never accept money, gifts, or favours from anyone about a report
  * Never discuss a specific pending report in a WhatsApp group or on social media before it's decided
  * Never approve or reject a claim from your own ward or a report you have a personal stake in — ask the other moderator instead
  * Never reject a claim just because you personally doubt it without a documented reason (GPS, photo reuse, confirmer pattern, etc.)



## 7\. If someone pressures or threatens you

If a councillor, official, party worker, or anyone else pressures or threatens you over a moderation decision:

  1. Do not respond to them directly.
  2. Save the message, screenshot, or recording.
  3. Forward it to the other moderator and to whoever is coordinating the project.
  4. Continue moderating on the merits, as usual.



## 8\. Who to contact

  * Second moderator: ____________________
  * Project coordinator: ____________________
  * Grievance Officer (legal matters, takedown requests): `thelosthillproject@gmail.com`



## 9\. The principle

Every correctly approved claim makes the public record stronger. Every correctly rejected fake claim protects the record's credibility. Your judgment is what makes the record trustworthy — that's the whole job.
